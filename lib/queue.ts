import "server-only";

import { Queue } from "bullmq";

import { env } from "@/lib/env";
import { type TriggerEvent } from "@/lib/dag/runner";

/**
 * BullMQ queue for workflow executions.
 *
 * Job id = executionId: BullMQ deduplicates by jobId, so a replayed webhook
 * delivery (same idempotency key) cannot enqueue a second job.
 *
 * The queue is created lazily with a `lazyConnect` Redis connection so that
 * merely importing this module never opens a socket (build-safe, test-safe).
 */

export const WORKFLOW_QUEUE_NAME = "relayflow.workflow-runs";

export interface WorkflowRunJobData {
  type: "webhook" | "manual" | "schedule" | "retry";
  organizationId: string;
  workflowId: string;
  executionId: string;
  event: TriggerEvent;
}

declare global {
  var __relayflowQueue: Queue | undefined;
}

function queueConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.slice(1) ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  };
}

function createQueue(): Queue {
  return new Queue(WORKFLOW_QUEUE_NAME, {
    connection: queueConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 2_000 },
      removeOnFail: { count: 5_000 },
    },
  });
}

function getQueue(): Queue {
  if (process.env.NODE_ENV !== "production") {
    globalThis.__relayflowQueue ??= createQueue();
    return globalThis.__relayflowQueue;
  }
  return createQueue();
}

export async function enqueueWorkflowRun(data: WorkflowRunJobData): Promise<string> {
  await getQueue().add(`run:${data.type}:${data.executionId}`, data, {
    jobId: data.executionId,
    attempts: 1,
    removeOnComplete: 5_000,
    removeOnFail: 10_000,
  });
  return data.executionId;
}

export async function closeQueue(): Promise<void> {
  if (globalThis.__relayflowQueue) {
    await globalThis.__relayflowQueue.close();
    globalThis.__relayflowQueue = undefined;
  }
}