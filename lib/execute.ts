import "server-only";

import { prisma } from "@/lib/db";
import { runWorkflow, type TriggerEvent } from "@/lib/dag/runner";
import { safeParseWorkflowGraph } from "@/lib/dag/schema";
import { dispatchStep } from "@/lib/dispatch";
import { decryptCredential } from "@/lib/data/credentials";
import {
  appendStepLogs,
  createRun,
  findRunByExecutionId,
  recordRunFailure,
  updateRun,
} from "@/lib/data/runs";
import { recordAudit } from "@/lib/audit";
import { type WorkflowRunJobData } from "@/lib/queue";

/**
 * Orchestrates a single workflow execution for a BullMQ worker.
 *
 * Idempotency: `createRun` is guarded by the unique constraint on
 * `(organizationId, executionId)` (P2002 → no-op), so replayed deliveries are
 * safe. Step log records from the runner's onStep callback are streamed to
 * `step_logs` so a run page can render live progress.
 */

const MAX_STEP_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;

export interface ExecuteResult {
  outcome: "alreadyRan" | "ignored" | "started" | "graphInvalid";
  runId?: string;
  status?: string;
  durationMs?: number;
  error?: string;
}

export async function executeWorkflowRun(data: WorkflowRunJobData): Promise<ExecuteResult> {
  const { organizationId, workflowId, executionId, event } = data;

  const existing = await findRunByExecutionId(organizationId, executionId);
  if (existing) {
    return { outcome: "alreadyRan", runId: existing.id, status: existing.status };
  }

  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, organizationId },
    select: { id: true, name: true, status: true, version: true, graph: true },
  });
  if (!workflow) {
    return { outcome: "ignored" };
  }
  if (data.type !== "manual" && workflow.status !== "active") {
    return { outcome: "ignored" };
  }

  const parsed = safeParseWorkflowGraph(workflow.graph as unknown);
  if (!parsed.ok) {
    const run = await createRun(organizationId, {
      workflowId,
      workflowVersion: workflow.version,
      executionId,
      status: "failed",
      eventId: event.id,
      eventPayload: event.payload,
      triggerType: data.type,
    });
    if (run) {
      await recordRunFailure(organizationId, {
        workflowId,
        runId: run.id,
        executionId,
        error: `Workflow graph is invalid: ${parsed.errors.join("; ")}`,
        attempts: 0,
        payload: event.payload,
      });
    }
    return { outcome: "graphInvalid", runId: run?.id };
  }

  const run = await createRun(organizationId, {
    workflowId,
    workflowVersion: workflow.version,
    executionId,
    status: "started",
    eventId: event.id,
    eventPayload: event.payload,
    triggerType: data.type,
  });
  if (!run) {
    return { outcome: "alreadyRan" };
  }

  const startedAt = Date.now();
  const result = await runWorkflow({
    graph: parsed.graph,
    executionId,
    organizationId,
    workflowId,
    event: event as TriggerEvent,
    maxAttempts: MAX_STEP_ATTEMPTS,
    backoffBaseMs: BACKOFF_BASE_MS,
    dispatch: async (node, context) =>
      dispatchStep(node, context, {
        getCredentialSecret: async (orgId, credentialId) =>
          (await decryptCredential(orgId, credentialId)).secret,
      }),
    onStep: async (record) => {
      await appendStepLogs(organizationId, run.id, [record]).catch((cause) => {
        console.error("[run] failed to persist step log", { runId: run.id, cause });
      });
    },
  });

  const durationMs = result.durationMs;

  if (result.status === "failed") {
    const failedStep = result.steps[result.steps.length - 1];
    await updateRun(organizationId, run.id, {
      status: "failed",
      durationMs,
      finishedAt: new Date(startedAt + durationMs),
    });
    await recordRunFailure(organizationId, {
      workflowId,
      runId: run.id,
      executionId,
      error: failedStep?.errorMessage ?? "Workflow failed.",
      attempts: failedStep?.attempt ?? 1,
      payload: event.payload,
    });
    return { outcome: "started", runId: run.id, status: "failed", durationMs };
  }

  const runStatus = result.status === "filtered" ? "filtered" : "succeeded";
  await updateRun(organizationId, run.id, {
    status: runStatus,
    durationMs,
    finishedAt: new Date(startedAt + durationMs),
  });
  await recordAudit({
    organizationId,
    action: "workflow.executed",
    resourceType: "workflow",
    resourceId: workflowId,
    metadata: { executionId, status: runStatus, runId: run.id },
  });

  return { outcome: "started", runId: run.id, status: runStatus, durationMs };
}