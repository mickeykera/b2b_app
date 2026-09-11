import "server-only";

import { Queue } from "bullmq";

import { redis } from "@/lib/redis";
import { prisma } from "@/lib/db";
import { WORKFLOW_QUEUE_NAME } from "@/lib/queue";
import { safeParseWorkflowGraph } from "@/lib/dag/schema";

/**
 * Scheduling for `schedule` triggers via BullMQ's upsertJobScheduler.
 *
 * One cron scheduler per (organization, workflow, triggerKey). The scheduler
 * id encodes the tenant + workflow so the worker can reconstruct the event
 * without a lookup table:
 *
 *   scr:<organizationId>:<workflowId>:<triggerKey>
 *
 * `refreshAllSchedules()` is called by scripts/scheduler.ts and on workflow
 * activate/pause so the scheduler set always matches active workflows.
 */

export const SCHEDULE_PREFIX = "scr:";

export interface ScheduleJobData {
  type: "schedule";
  organizationId: string;
  workflowId: string;
  triggerKey: string;
  cron: string;
  timezone: string;
}

export function scheduleIdFor(organizationId: string, workflowId: string, triggerKey: string): string {
  return `${SCHEDULE_PREFIX}${organizationId}:${workflowId}:${triggerKey}`;
}

export function parseScheduleId(scheduleId: string): ScheduleJobData | null {
  if (!scheduleId.startsWith(SCHEDULE_PREFIX)) {
    return null;
  }
  const parts = scheduleId.slice(SCHEDULE_PREFIX.length).split(":");
  if (parts.length !== 3) {
    return null;
  }
  return {
    type: "schedule",
    organizationId: parts[0]!,
    workflowId: parts[1]!,
    triggerKey: parts[2]!,
    cron: "",
    timezone: "",
  };
}

export async function reconfigureWorkflowSchedule(
  organizationId: string,
  workflowId: string,
  graph: { nodes: unknown[] },
): Promise<void> {
  const scheduler = new Queue(WORKFLOW_QUEUE_NAME, { connection: redis });
  try {
    const parsed = safeParseWorkflowGraph(graph as unknown);
    if (!parsed.ok) {
      return;
    }
    for (const node of parsed.graph.nodes) {
      if (node.type !== "trigger" || node.config.subtype !== "schedule") {
        continue;
      }
      const scheduleId = scheduleIdFor(organizationId, workflowId, node.key);
      await scheduler.upsertJobScheduler(
        scheduleId,
        { pattern: node.config.cron, tz: node.config.timezone },
        {
          name: `schedule:${scheduleId}`,
          data: {
            type: "schedule",
            organizationId,
            workflowId,
            triggerKey: node.key,
            cron: node.config.cron,
            timezone: node.config.timezone,
          } satisfies ScheduleJobData,
        },
      );
    }
  } finally {
    await scheduler.close();
  }
}

export async function removeWorkflowSchedules(organizationId: string, workflowId: string): Promise<void> {
  const scheduler = new Queue(WORKFLOW_QUEUE_NAME, { connection: redis });
  try {
    const jobs = await scheduler.getJobSchedulers();
    const prefix = `${SCHEDULE_PREFIX}${organizationId}:${workflowId}:`;
    await Promise.all(
      jobs.filter((job) => job.key.startsWith(prefix)).map((job) => scheduler.removeJobScheduler(job.key)),
    );
  } finally {
    await scheduler.close();
  }
}

export async function refreshAllSchedules(): Promise<number> {
  const scheduler = new Queue(WORKFLOW_QUEUE_NAME, { connection: redis });
  try {
    const workflows = await prisma.workflow.findMany({
      where: { status: "active" },
      select: { id: true, organizationId: true, graph: true },
    });

    let configured = 0;
    for (const workflow of workflows) {
      const parsed = safeParseWorkflowGraph(workflow.graph as unknown);
      if (!parsed.ok) {
        continue;
      }
      for (const node of parsed.graph.nodes) {
        if (node.type !== "trigger" || node.config.subtype !== "schedule") {
          continue;
        }
        const scheduleId = scheduleIdFor(workflow.organizationId, workflow.id, node.key);
        await scheduler.upsertJobScheduler(
          scheduleId,
          { pattern: node.config.cron, tz: node.config.timezone },
          {
            name: `schedule:${scheduleId}`,
            data: {
              type: "schedule",
              organizationId: workflow.organizationId,
              workflowId: workflow.id,
              triggerKey: node.key,
              cron: node.config.cron,
              timezone: node.config.timezone,
            } satisfies ScheduleJobData,
          },
        );
        configured += 1;
      }
    }
    return configured;
  } finally {
    await scheduler.close();
  }
}

/**
 * Reconciler: diff the live scheduler set against the desired set derived from
 * active workflows and repair drift. Called periodically by scripts/scheduler.ts
 * (now a long-running loop) so a stale scheduler cannot survive a crash, a
 * previously-deactivated workflow, or a missed cleanup path.
 */
export async function reconcileSchedules(): Promise<{
  expected: number;
  found: number;
  upserted: number;
  removed: number;
}> {
  const scheduler = new Queue(WORKFLOW_QUEUE_NAME, { connection: redis });
  try {
    const workflows = await prisma.workflow.findMany({
      where: { status: "active" },
      select: { id: true, organizationId: true, graph: true },
    });

    const desired = new Set<string>();
    let upserted = 0;
    for (const workflow of workflows) {
      const parsed = safeParseWorkflowGraph(workflow.graph as unknown);
      if (!parsed.ok) {
        continue;
      }
      for (const node of parsed.graph.nodes) {
        if (node.type !== "trigger" || node.config.subtype !== "schedule") {
          continue;
        }
        const scheduleId = scheduleIdFor(workflow.organizationId, workflow.id, node.key);
        desired.add(scheduleId);
        await scheduler.upsertJobScheduler(
          scheduleId,
          { pattern: node.config.cron, tz: node.config.timezone },
          {
            name: `schedule:${scheduleId}`,
            data: {
              type: "schedule",
              organizationId: workflow.organizationId,
              workflowId: workflow.id,
              triggerKey: node.key,
              cron: node.config.cron,
              timezone: node.config.timezone,
            } satisfies ScheduleJobData,
            opts: { removeOnComplete: 1_000, removeOnFail: 1_000 },
          },
        );
        upserted += 1;
      }
    }

    const existing = await scheduler.getJobSchedulers();
    const stale = existing
      .filter((job) => job.key.startsWith(SCHEDULE_PREFIX) && !desired.has(job.key))
      .map((job) => job.key);
    await Promise.all(stale.map((key) => scheduler.removeJobScheduler(key)));

    return {
      expected: desired.size,
      found: existing.filter((job) => job.key.startsWith(SCHEDULE_PREFIX)).length,
      upserted,
      removed: stale.length,
    };
  } finally {
    await scheduler.close();
  }
}