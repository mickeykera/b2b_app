import { describe, expect, it, vi } from "vitest";

import { parseWorkflowGraph, safeParseWorkflowGraph, type WorkflowGraph, type TriggerNode } from "@/lib/dag/schema";
import {
  PermanentActionError,
  RetryableActionError,
  WorkflowGraphError,
  type DispatchFn,
  jitteredBackoffMs,
  runWorkflow,
} from "@/lib/dag/runner";

const ORG = "org_test";
const RUN = "run_test_exec";

function trigger(): TriggerNode {
  return {
    type: "trigger",
    key: "t_webhook",
    config: { subtype: "webhook", endpointSlug: "orders-created" },
  };
}

function buildGraph(nodes: WorkflowGraph["nodes"]): WorkflowGraph {
  const keys = nodes.map((n) => n.key);
  const edges = keys.slice(1).map((key, i) => ({ from: keys[i]!, to: key }));
  return parseWorkflowGraph({ nodes, edges });
}

function okDispatch(): DispatchFn {
  return async (node, _context, attempt) => ({
    ok: true,
    retryable: false,
    httpStatus: 200,
    output: { step: node.key, attempt, sent: true },
  });
}

function httpAction(
  overrides: { key?: string; url?: string; method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" } = {},
): WorkflowGraph["nodes"][number] {
  return {
    type: "action",
    key: overrides.key ?? "a_action",
    config: {
      subtype: "http",
      method: overrides.method ?? "POST",
      url: overrides.url ?? "https://example.com",
      headers: [],
      auth: { type: "none" },
      timeoutMs: 10_000,
    },
  };
}

const event = { id: "evt_1", occurredAtMs: Date.now(), payload: { status: "paid", amount: 100, user: { email: "a@b.com" } } };

describe("runWorkflow · happy path", () => {
  it("executes trigger -> filter -> transform -> action and records steps", async () => {
    const graph = buildGraph([
      trigger(),
      {
        type: "filter",
        key: "f_paid",
        config: { mode: "all", conditions: [{ path: "$.payload.status", operator: "eq", value: "paid" }] },
      },
      {
        type: "transform",
        key: "x_map",
        config: {
          mappings: [
            { from: "$.payload.user.email", to: "recipient" },
            { from: "$.payload.amount", to: "total" },
          ],
        },
      },
      httpAction({ key: "a_notify", url: "https://api.example.com/orders" }),
    ]);

    const dispatch = vi.fn(okDispatch());
    const result = await runWorkflow({
      graph,
      executionId: RUN,
      organizationId: ORG,
      workflowId: "wf_1",
      event,
      dispatch,
      sleep: async () => {},
    });

    expect(result.status).toBe("succeeded");
    expect(result.steps.map((s) => s.stepKey)).toEqual(["t_webhook", "f_paid", "x_map", "a_notify"]);
    expect(result.steps.every((s) => s.status === "succeeded")).toBe(true);
    const transformStep = result.steps.find((s) => s.stepKey === "x_map")!;
    expect(transformStep.output).toEqual({ recipient: "a@b.com", total: 100 });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("maps a missing transform source to null instead of failing", async () => {
    const graph = buildGraph([
      trigger(),
      {
        type: "transform",
        key: "x_missing",
        config: { mappings: [{ from: "$.payload.nope.deep", to: "value" }] },
      },
      httpAction({ key: "a_ok", method: "GET", url: "https://example.com" }),
    ]);
    const result = await runWorkflow({
      graph,
      executionId: RUN,
      organizationId: ORG,
      workflowId: "wf_1",
      event,
      dispatch: okDispatch(),
      sleep: async () => {},
    });
    expect(result.status).toBe("succeeded");
    expect(result.steps.find((s) => s.stepKey === "x_missing")!.output).toEqual({ value: null });
  });
});

describe("runWorkflow · filters", () => {
  it("short-circuits when a filter fails (status filtered, downstream skipped)", async () => {
    const graph = buildGraph([
      trigger(),
      {
        type: "filter",
        key: "f_refunded",
        config: { mode: "all", conditions: [{ path: "$.payload.status", operator: "eq", value: "refunded" }] },
      },
      httpAction({ key: "a_send", method: "POST", url: "https://example.com" }),
    ]);
    const dispatch = vi.fn(okDispatch());
    const result = await runWorkflow({
      graph,
      executionId: RUN,
      organizationId: ORG,
      workflowId: "wf_1",
      event,
      dispatch,
      sleep: async () => {},
    });
    expect(result.status).toBe("filtered");
    const actionStep = result.steps.find((s) => s.stepKey === "a_send")!;
    expect(actionStep.status).toBe("skipped");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("supports any-mode and numeric comparisons", async () => {
    const graph = buildGraph([
      trigger(),
      {
        type: "filter",
        key: "f_big",
        config: {
          mode: "any",
          conditions: [
            { path: "$.payload.amount", operator: "gt", value: 1000 },
            { path: "$.payload.enabled", operator: "eq", value: true },
          ],
        },
      },
      httpAction({ key: "a_send", method: "GET", url: "https://example.com" }),
    ]);
    const result = await runWorkflow({
      graph,
      executionId: RUN,
      organizationId: ORG,
      workflowId: "wf_1",
      event: { ...event, payload: { enabled: true } },
      dispatch: okDispatch(),
      sleep: async () => {},
    });
    expect(result.status).toBe("succeeded");
  });
});

describe("runWorkflow · retries with exponential backoff + jitter", () => {
  it("retries a transient 5xx and succeeds on the second attempt", async () => {
    const graph = buildGraph([
      trigger(),
      httpAction({ key: "a_http", method: "POST", url: "https://example.com" }),
    ]);
    const calls: number[] = [];
    const dispatch: DispatchFn = async (_node, _ctx, attempt) => {
      calls.push(attempt);
      if (attempt === 1) {
        return { ok: false, retryable: true, httpStatus: 502, errorMessage: "Bad gateway" };
      }
      return { ok: true, retryable: false, httpStatus: 200, output: { done: true } };
    };
    const sleeps: number[] = [];
    const result = await runWorkflow({
      graph,
      executionId: RUN,
      organizationId: ORG,
      workflowId: "wf_1",
      event,
      dispatch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      backoffBaseMs: 100,
      maxAttempts: 3,
    });
    expect(result.status).toBe("succeeded");
    expect(calls).toEqual([1, 2]);
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]!).toBeGreaterThanOrEqual(0);
    expect(sleeps[0]!).toBeLessThan(100);
  });

  it("exhausts retries on persistent 5xx and marks the run failed", async () => {
    const graph = buildGraph([
      trigger(),
      httpAction({ key: "a_flaky", method: "POST", url: "https://example.com" }),
    ]);
    const dispatch: DispatchFn = async () => ({ ok: false, retryable: true, httpStatus: 503, errorMessage: "Unavailable" });
    const sleeps: number[] = [];
    const result = await runWorkflow({
      graph,
      executionId: RUN,
      organizationId: ORG,
      workflowId: "wf_1",
      event,
      dispatch,
      maxAttempts: 3,
      backoffBaseMs: 50,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.status).toBe("failed");
    const step = result.steps.find((s) => s.stepKey === "a_flaky")!;
    expect(step.status).toBe("failed");
    expect(step.httpStatus).toBe(503);
    expect(step.output).toEqual({ attempts: 3 });
    expect(sleeps.length).toBe(2);
  });

  it("does not retry permanent (4xx / non-retryable) failures", async () => {
    const graph = buildGraph([
      trigger(),
      httpAction({ key: "a_perm", method: "POST", url: "https://example.com" }),
    ]);
    const dispatch = vi.fn(async () => ({ ok: false, retryable: false, httpStatus: 422, errorMessage: "Unprocessable" }));
    const result = await runWorkflow({
      graph,
      executionId: RUN,
      organizationId: ORG,
      workflowId: "wf_1",
      event,
      dispatch,
      maxAttempts: 3,
      sleep: async () => {},
    });
    expect(result.status).toBe("failed");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result.steps.find((s) => s.stepKey === "a_perm")!.attempt).toBe(1);
  });

  it("treats thrown RetryableActionError as retryable", async () => {
    const graph = buildGraph([
      trigger(),
      httpAction({ key: "a_throw", method: "GET", url: "https://example.com" }),
    ]);
    const dispatch: DispatchFn = async (_n, _c, attempt) => {
      if (attempt === 1) {
        throw new RetryableActionError("conn reset");
      }
      return { ok: true, retryable: false, httpStatus: 200, output: {} };
    };
    const result = await runWorkflow({
      graph,
      executionId: RUN,
      organizationId: ORG,
      workflowId: "wf_1",
      event,
      dispatch,
      maxAttempts: 2,
      sleep: async () => {},
    });
    expect(result.status).toBe("succeeded");
  });

  it("treats thrown PermanentActionError as non-retryable", async () => {
    const graph = buildGraph([
      trigger(),
      httpAction({ key: "a_throw", method: "GET", url: "https://example.com" }),
    ]);
    const dispatch = vi.fn(async () => {
      throw new PermanentActionError("invalid target");
    });
    const result = await runWorkflow({
      graph,
      executionId: RUN,
      organizationId: ORG,
      workflowId: "wf_1",
      event,
      dispatch,
      maxAttempts: 3,
      sleep: async () => {},
    });
    expect(result.status).toBe("failed");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe("runWorkflow · graph integrity", () => {
  it("rejects cyclic graphs at the schema layer and in the runner", async () => {
    const cyclic = {
      nodes: [
        trigger(),
        { type: "action", key: "a1", config: { subtype: "http", method: "GET", url: "https://example.com" } },
      ],
      edges: [
        { from: "t_webhook", to: "a1" },
        { from: "a1", to: "t_webhook" },
      ],
    };
    expect(() => parseWorkflowGraph(cyclic)).toThrow();
    // Defense-in-depth: the runner independently rejects unvalidated graphs.
    await expect(
      runWorkflow({
        graph: cyclic as WorkflowGraph,
        executionId: RUN,
        organizationId: ORG,
        workflowId: "wf",
        event,
        dispatch: okDispatch(),
      }),
    ).rejects.toThrow(WorkflowGraphError);
  });

  it("rejects graphs without exactly one trigger", () => {
    const verdict = safeParseWorkflowGraph({
      nodes: [
        { type: "trigger", key: "a", config: { subtype: "webhook", endpointSlug: "a-slug" } },
        { type: "trigger", key: "b", config: { subtype: "webhook", endpointSlug: "b-slug" } },
      ],
      edges: [],
    });
    expect(verdict.ok).toBe(false);
  });
});

describe("jitteredBackoffMs", () => {
  it("grows exponentially with attempts", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(jitteredBackoffMs(1, 100)).toBeLessThan(100);
    expect(jitteredBackoffMs(1, 100)).toBeGreaterThanOrEqual(0);
    expect(jitteredBackoffMs(2, 100)).toBeLessThan(200);
    expect(jitteredBackoffMs(3, 100)).toBeLessThan(400);
    vi.restoreAllMocks();
  });
});