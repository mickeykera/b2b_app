import "server-only";

import { Worker, type Job } from "bullmq";

import { redis } from "@/lib/redis";
import { WORKFLOW_QUEUE_NAME, type WorkflowRunJobData } from "@/lib/queue";
import { executeWorkflowRun } from "@/lib/execute";
import { parseScheduleId, type ScheduleJobData } from "@/lib/scheduler";
import { deriveExecutionId, newId } from "@/lib/ids";

/**
 * Workflow run worker. Processes two kinds of jobs on the workflow queue:
 *
 *  - `run:*` payloads (WorkflowRunJobData) produced by the API/webhook/scheduler
 *  - `schedule:...` jobs yielded by BullMQ cron schedulers (no data; the
 *    schedule id encodes org, workflow, and trigger key)
 */

function executionIdForWebhook(data: WorkflowRunJobData): string {
  return data.executionId;
}

export async function processJob(job: Job): Promise<Record<string, unknown>> {
  try {
    if (job.name.startsWith("schedule:")) {
      const data = job.data as ScheduleJobData;
      const parsed =
        data && data.organizationId && data.workflowId
          ? parseScheduleId(`${data.organizationId}:${data.workflowId}:${data.triggerKey}`)
          : parseScheduleId(job.name.replace(/^schedule:/, ""));
      if (!parsed) {
        return { outcome: "unknown_schedule" };
      }
      const eventId = newId("evt_");
      const occurredAtMs = Date.now();
      const executionId = deriveExecutionId(parsed.organizationId, parsed.workflowId, eventId, occurredAtMs);
      const result = await executeWorkflowRun({
        type: "schedule",
        organizationId: parsed.organizationId,
        workflowId: parsed.workflowId,
        executionId,
        event: {
          id: eventId,
          occurredAtMs,
          payload: { schedule: { triggerKey: parsed.triggerKey, firedAtMs: occurredAtMs } },
        },
      });
      return { outcome: result.outcome, runId: result.runId ?? "" };
    }

    const data = job.data as WorkflowRunJobData;
    const result = await executeWorkflowRun({
      ...data,
      executionId: executionIdForWebhook(data),
    });
    return { outcome: result.outcome, runId: result.runId ?? "" };
  } catch (cause) {
    console.error("[worker] job failed", { id: job.id, name: job.name, cause });
    throw cause;
  }
}

export function createWorker(concurrency = 5): Worker {
  const worker = new Worker(
    WORKFLOW_QUEUE_NAME,
    async (job) => processJob(job),
    {
      connection: redis,
      concurrency,
      lockDuration: 60_000,
    },
  );
  worker.on("failed", (job, err) => {
    console.error("[worker] job completed with failure", { id: job?.id, name: job?.name, error: err.message });
  });
  return worker;
}