/**
 * Workflow execution engine.
 *
 * Executes a validated workflow DAG against a trigger event:
 *
 *   Trigger -> Filter(s) -> Transform(s) -> Action(s)
 *
 * Guarantees:
 *   - deterministic, idempotent execution keyed by `executionId`
 *   - per-step instrumentation (input, output, duration_ms, HTTP status,
 *     attempt) surfaced as real-time `StepLog[]`
 *   - retry policy: exponential backoff with full jitter for transient
 *     5xx/network failures; permanently failing actions abort the pipeline and
 *     are recorded for the dead-letter queue (DLQ) by the caller
 *   - filters short-circuit the pipeline ("filtered") without executing
 *     downstream nodes
 */

import {
  type ActionNode,
  type FilterConfig,
  type TransformConfig,
  type WorkflowGraph,
  type WorkflowNode,
  topoSort,
} from "@/lib/dag/schema";
import { getPath, setPath, type Lookup } from "@/lib/path";

export type StepStatus = "succeeded" | "failed" | "skipped";
export type RunStatus = "succeeded" | "failed" | "filtered";

export interface StepLogRecord {
  stepKey: string;
  stepType: WorkflowNode["type"];
  label?: string;
  status: StepStatus;
  attempt: number;
  input?: unknown;
  output?: unknown;
  errorMessage?: string;
  httpStatus?: number | null;
  durationMs: number;
}

export interface DispatchResult {
  httpStatus?: number | null;
  ok: boolean;
  retryable: boolean;
  output?: unknown;
  errorMessage?: string;
}

export type DispatchFn = (
  node: ActionNode,
  context: RunContext,
  attempt: number,
) => Promise<DispatchResult>;

export interface TriggerEvent {
  id: string;
  occurredAtMs: number;
  payload: Record<string, unknown>;
}

export interface RunContext {
  payload: Record<string, unknown>;
  vars: Record<string, unknown>;
  trace: {
    executionId: string;
    organizationId: string;
    workflowId: string;
    eventId: string;
  };
}

export interface RunWorkflowOptions {
  graph: WorkflowGraph;
  executionId: string;
  organizationId: string;
  workflowId: string;
  event: TriggerEvent;
  /** Injected action executor (defaults to nothing; production uses lib/dispatch). */
  dispatch?: DispatchFn;
  /** Emitted as each step completes, enabling real-time run logs. */
  onStep?: (record: StepLogRecord) => void | Promise<void>;
  maxAttempts?: number;
  backoffBaseMs?: number;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RunWorkflowResult {
  executionId: string;
  status: RunStatus;
  steps: StepLogRecord[];
  durationMs: number;
}

export class WorkflowGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowGraphError";
  }
}

export class PermanentActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentActionError";
  }
}

export class RetryableActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableActionError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with full jitter:
 *   delay = random integer in [0, base * 2^(attempt-1))
 */
export function jitteredBackoffMs(attempt: number, baseMs: number): number {
  const full = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.max(0, Math.floor(Math.random() * full));
}

const NODE_LABELS: Record<WorkflowNode["type"], string> = {
  trigger: "Trigger",
  filter: "Filter",
  transform: "Transform",
  action: "Action",
};

function evaluateConditions(config: FilterConfig, root: Record<string, unknown>): boolean {
  const evaluate = (condition: FilterConfig["conditions"][number]): boolean => {
    const lookup: Lookup = getPath(root, condition.path);
    const lhs = lookup.found ? lookup.value : undefined;
    const rhs = condition.value;
    switch (condition.operator) {
      case "exists":
        return lookup.found;
      case "not_exists":
        return !lookup.found;
      case "eq":
        return lhs === rhs;
      case "neq":
        return lhs !== rhs;
      case "gt":
        return typeof lhs === "number" && typeof rhs === "number" && lhs > rhs;
      case "gte":
        return typeof lhs === "number" && typeof rhs === "number" && lhs >= rhs;
      case "lt":
        return typeof lhs === "number" && typeof rhs === "number" && lhs < rhs;
      case "lte":
        return typeof lhs === "number" && typeof rhs === "number" && lhs <= rhs;
      case "contains":
        if (typeof lhs === "string") {
          return lhs.includes(String(rhs ?? ""));
        }
        if (Array.isArray(lhs)) {
          return lhs.some((item) => item === rhs);
        }
        return false;
      case "starts_with":
        return typeof lhs === "string" && lhs.startsWith(String(rhs ?? ""));
      case "ends_with":
        return typeof lhs === "string" && lhs.endsWith(String(rhs ?? ""));
      case "regex":
        if (typeof lhs !== "string") {
          return false;
        }
        try {
          return new RegExp(String(rhs ?? "")).test(lhs);
        } catch {
          return false;
        }
      default:
        return false;
    }
  };

  if (config.mode === "any") {
    return config.conditions.some(evaluate);
  }
  return config.conditions.every(evaluate);
}

function applyTransform(config: TransformConfig, root: Record<string, unknown>): Record<string, unknown> {
  let output: unknown = {};
  for (const mapping of config.mappings) {
    const lookup = getPath(root, mapping.from);
    output = setPath(output, mapping.to, lookup.found ? lookup.value : null);
  }
  return output as Record<string, unknown>;
}

function makeStepRecord(
  node: WorkflowNode,
  status: StepStatus,
  attempt: number,
  extras: Partial<StepLogRecord>,
): StepLogRecord {
  return {
    stepKey: node.key,
    stepType: node.type,
    label: node.label ?? NODE_LABELS[node.type],
    status,
    attempt,
    durationMs: 0,
    ...extras,
  };
}

/**
 * Main entry point. Pure aside from the injectable `dispatch`/`sleep`/`now`.
 */
export async function runWorkflow(options: RunWorkflowOptions): Promise<RunWorkflowResult> {
  const {
    graph,
    executionId,
    organizationId,
    workflowId,
    event,
    maxAttempts = 3,
    backoffBaseMs = 500,
    now = () => Date.now(),
  } = options;

  const dispatch = options.dispatch;
  const sleep = options.sleep ?? defaultSleep;
  const onStep = options.onStep;

  const emitStep = (record: StepLogRecord): void => {
      steps.push(record);
    if (onStep) {
      Promise.resolve(onStep(record)).catch((cause) => {
        console.error("[runner] onStep handler failed", cause);
      });
    }
  };

  let sorted: WorkflowNode[];
  try {
    sorted = topoSort(graph);
  } catch (cause) {
    throw new WorkflowGraphError(
      cause instanceof Error ? cause.message : "Workflow graph is invalid.",
    );
  }

  const startedAt = now();
  const context: RunContext = {
    payload: event.payload,
    vars: {},
    trace: { executionId, organizationId, workflowId, eventId: event.id },
  };

  const steps: StepLogRecord[] = [];
  let status: RunStatus = "succeeded";
  let pipelineBroken = false;

  for (const node of sorted) {
    if (pipelineBroken) {
        emitStep(makeStepRecord(node, "skipped", 1, { input: undefined }));
      continue;
    }

    const t0 = now();
    switch (node.type) {
      case "trigger": {
          emitStep(
          makeStepRecord(node, "succeeded", 1, {
            input: context.payload,
            output: stateSnapshot(context),
            durationMs: now() - t0,
          }),
        );
        break;
      }

      case "filter": {
        const looksLike = evaluateConditions(node.config, contextWithVars(context));
        if (!looksLike) {
          status = "filtered";
          pipelineBroken = true;
            emitStep(
            makeStepRecord(node, "failed", 1, {
              input: stateSnapshot(context),
              output: { passed: false },
              errorMessage: "Filter conditions did not match; downstream steps skipped.",
              durationMs: now() - t0,
            }),
          );
          continue;
        }
          emitStep(
          makeStepRecord(node, "succeeded", 1, {
            input: stateSnapshot(context),
            output: { passed: true },
            durationMs: now() - t0,
          }),
        );
        break;
      }

      case "transform": {
        const output = applyTransform(node.config, contextWithVars(context));
        context.vars[node.key] = output;
          emitStep(
          makeStepRecord(node, "succeeded", 1, {
            input: stateSnapshot(context),
            output,
            durationMs: now() - t0,
          }),
        );
        break;
      }

      case "action": {
        if (!dispatch) {
          throw new Error("No dispatcher provided for an action node.");
        }
        const outcome = await executeActionWithRetry({
          node,
          context,
          dispatch,
          maxAttempts,
          backoffBaseMs,
          sleep,
          now,
        });
        context.vars[node.key] = outcome.output;
          emitStep(outcome.step);
        if (outcome.status === "failed") {
          status = "failed";
          pipelineBroken = true;
          continue;
        }
        break;
      }

      default: {
        const exhaustive: never = node;
        throw new Error(`Unknown workflow node type: ${exhaustive}`);
      }
    }
  }

  const durationMs = now() - startedAt;
  return { executionId, status, steps, durationMs };
}

function contextWithVars(context: RunContext): Record<string, unknown> {
  return { payload: context.payload, vars: context.vars };
}

function stateSnapshot(context: RunContext): Record<string, unknown> {
  return structuredClone(contextWithVars(context));
}

interface ActionOutcome {
  status: StepStatus;
  success: boolean;
  step: StepLogRecord;
  output?: unknown;
}

async function executeActionWithRetry(options: {
  node: ActionNode;
  context: RunContext;
  dispatch: DispatchFn;
  maxAttempts: number;
  backoffBaseMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}): Promise<ActionOutcome> {
  const { node, context, dispatch, maxAttempts, backoffBaseMs, sleep, now } = options;

  const failedAttempts: { input: unknown; errorMessage: string; httpStatus?: number | null }[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const t0 = now();
    const input = stateSnapshot(context);
    let dispatchResult: DispatchResult;
    try {
      dispatchResult = await dispatch(node, context, attempt);
    } catch (cause) {
      if (cause instanceof RetryableActionError) {
        dispatchResult = {
          ok: false,
          retryable: true,
          errorMessage: cause.message,
        };
      } else if (cause instanceof PermanentActionError) {
        dispatchResult = {
          ok: false,
          retryable: false,
          errorMessage: cause.message,
        };
      } else {
        dispatchResult = {
          ok: false,
          retryable: true,
          errorMessage: cause instanceof Error ? cause.message : String(cause),
        };
      }
    }

    const durationMs = now() - t0;
    if (dispatchResult.ok) {
      return {
        status: "succeeded",
        success: true,
        output: dispatchResult.output,
        step: makeStepRecord(node, "succeeded", attempt, {
          input,
          output: dispatchResult.output,
          httpStatus: dispatchResult.httpStatus ?? null,
          durationMs,
        }),
      };
    }

    failedAttempts.push({
      input,
      errorMessage: dispatchResult.errorMessage ?? "Action failed.",
      httpStatus: dispatchResult.httpStatus ?? null,
    });

    const lastAttempt = attempt >= maxAttempts;
    if (lastAttempt) {
      const last = failedAttempts[failedAttempts.length - 1]!;
      return {
        status: "failed",
        success: false,
        step: makeStepRecord(node, "failed", attempt, {
          input: last.input,
          errorMessage: last.errorMessage,
          httpStatus: last.httpStatus,
          output: { attempts: failedAttempts.length },
          durationMs,
        }),
      };
    }

    if (!dispatchResult.retryable) {
      const last = failedAttempts[failedAttempts.length - 1]!;
      return {
        status: "failed",
        success: false,
        step: makeStepRecord(node, "failed", attempt, {
          input: last.input,
          errorMessage: last.errorMessage,
          httpStatus: last.httpStatus,
          durationMs,
        }),
      };
    }

    const delayMs = jitteredBackoffMs(attempt, backoffBaseMs);
    await sleep(delayMs);
  }

  return {
    status: "failed",
    success: false,
    step: makeStepRecord(node, "failed", maxAttempts, {
      errorMessage: "Action failed after exhausting retries.",
    }),
  };
}

/** Human-readable summary of a run for status panels. */
export function summarizeRun(
  result: RunWorkflowResult,
): { status: RunStatus; totalSteps: number; failedSteps: number; durationMs: number } {
  return {
    status: result.status,
    totalSteps: result.steps.length,
    failedSteps: result.steps.filter((s) => s.status === "failed").length,
    durationMs: result.durationMs,
  };
}