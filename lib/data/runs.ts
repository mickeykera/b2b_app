import "server-only";

import { Prisma } from "@/src/generated/prisma/client";

import { prisma } from "@/lib/db";
import { type StepLogRecord } from "@/lib/dag/runner";
import { recordAudit } from "@/lib/audit";

/**
 * Organization-scoped workflow run repository. All reads/writes filter by
 * `organizationId`.
 */

export interface CreateRunInput {
  workflowId: string;
  workflowVersion: number;
  executionId: string;
  status: string;
  eventId?: string | null;
  eventPayload: Record<string, unknown>;
  triggerType?: string | null;
}

export async function findRunByExecutionId(organizationId: string, executionId: string) {
  return prisma.workflowRun.findUnique({
    where: { executionId },
  }).then((run) => (run && run.organizationId === organizationId ? run : null));
}

export async function createRun(organizationId: string, input: CreateRunInput) {
  try {
    return await prisma.workflowRun.create({
      data: {
        organizationId,
        workflowId: input.workflowId,
        workflowVersion: input.workflowVersion,
        executionId: input.executionId,
        status: input.status,
        eventId: input.eventId ?? null,
        eventPayload: input.eventPayload as Prisma.InputJsonValue,
        triggerType: input.triggerType ?? null,
        startedAt: new Date(),
      },
    });
  } catch (cause) {
    if (
      cause instanceof Prisma.PrismaClientKnownRequestError &&
      cause.code === "P2002"
    ) {
      return null;
    }
    throw cause;
  }
}

export async function updateRun(
  organizationId: string,
  runId: string,
  patch: {
    status?: string;
    durationMs?: number;
    finishedAt?: Date | null;
  },
) {
  return prisma.workflowRun.updateMany({
    where: { id: runId, organizationId },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
      ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
    },
  });
}

export interface RunListItem {
  id: string;
  executionId: string;
  workflowId: string;
  workflowName: string | null;
  status: string;
  triggerType: string | null;
  durationMs: number | null;
  createdAt: Date;
}

export async function listRuns(
  organizationId: string,
  options: { page?: number; pageSize?: number; status?: string } = {},
): Promise<{ items: RunListItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const where: Prisma.WorkflowRunWhereInput = {
    organizationId,
    ...(options.status ? { status: options.status } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.workflowRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        executionId: true,
        workflowId: true,
        workflow: { select: { name: true } },
        status: true,
        triggerType: true,
        durationMs: true,
        createdAt: true,
      },
    }),
    prisma.workflowRun.count({ where }),
  ]);
  const items = rows.map((row) => ({
    id: row.id,
    executionId: row.executionId,
    workflowId: row.workflowId,
    workflowName: row.workflow?.name ?? null,
    status: row.status,
    triggerType: row.triggerType,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  }));
  return { items, total, page, pageSize };
}

export async function getRun(organizationId: string, runId: string) {
  return prisma.workflowRun.findFirst({
    where: { id: runId, organizationId: { equals: organizationId } },
    include: {
      workflow: { select: { id: true, name: true, status: true } },
      steps: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function appendStepLogs(
  organizationId: string,
  runId: string,
  logs: StepLogRecord[],
) {
  if (logs.length === 0) {
    return;
  }
  const existing = await prisma.workflowRun.findFirst({
    where: { id: runId, organizationId },
    select: { id: true },
  });
  if (!existing) {
    return;
  }
  await prisma.stepLog.createMany({
    data: logs.map((log) => ({
      organizationId,
      runId,
      stepKey: log.stepKey,
      stepType: log.stepType,
      label: log.label ?? null,
      status: log.status,
      attempt: log.attempt,
      input:
        log.input === null || log.input === undefined
          ? Prisma.DbNull
          : (log.input as Prisma.InputJsonValue),
      output:
        log.output === null || log.output === undefined
          ? Prisma.DbNull
          : (log.output as Prisma.InputJsonValue),
      errorMessage: log.errorMessage ?? null,
      httpStatus: log.httpStatus ?? null,
      durationMs: log.durationMs,
    })),
  });
}

export async function appendSingleStepLog(
  organizationId: string,
  runId: string,
  log: StepLogRecord,
) {
  await appendStepLogs(organizationId, runId, [log]);
}

export interface DeadLetterInput {
  workflowId: string;
  runId?: string | null;
  stepKey: string;
  stepType: string;
  payload: Record<string, unknown>;
  error: string;
  attempts: number;
  source?: string;
}

export async function createDeadLetter(organizationId: string, input: DeadLetterInput) {
  return prisma.deadLetter.create({
    data: {
      organizationId,
      workflowId: input.workflowId,
      runId: input.runId ?? null,
      stepKey: input.stepKey,
      stepType: input.stepType,
      payload: input.payload as Prisma.InputJsonValue,
      error: input.error,
      attempts: input.attempts,
      source: input.source ?? null,
    },
  });
}

export async function listDeadLetters(
  organizationId: string,
  options: { workflowId?: string; limit?: number } = {},
) {
  return prisma.deadLetter.findMany({
    where: {
      organizationId,
      ...(options.workflowId ? { workflowId: options.workflowId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 100,
  });
}

export async function getDeadLetter(organizationId: string, id: string) {
  return prisma.deadLetter.findFirst({ where: { id, organizationId } });
}

export async function recordRunFailure(
  organizationId: string,
  input: {
    workflowId: string;
    runId?: string | null;
    executionId: string;
    error: string;
    attempts: number;
    payload: Record<string, unknown>;
  },
) {
  await createDeadLetter(organizationId, {
    workflowId: input.workflowId,
    runId: input.runId ?? null,
    stepKey: "workflow",
    stepType: "workflow",
    payload: input.payload,
    error: input.error,
    attempts: input.attempts,
    source: "engine",
  });
  await recordAudit({
    organizationId,
    action: "run.failed",
    resourceType: "workflow_run",
    resourceId: input.runId ?? input.executionId,
    metadata: { executionId: input.executionId, error: input.error },
  });
}

/** Run metrics for the overview dashboard. */
export async function getRunMetrics(organizationId: string) {
  const [totalToday, failed24h, total, avgDuration] = await Promise.all([
    prisma.workflowRun.count({
      where: {
        organizationId,
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.workflowRun.count({
      where: {
        organizationId,
        status: { in: ["failed"] },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.workflowRun.count({ where: { organizationId } }),
    prisma.workflowRun.aggregate({
      where: { organizationId, durationMs: { not: null } },
      _avg: { durationMs: true },
    }),
  ]);
  return {
    runsToday: totalToday,
    failedLast24h: failed24h,
    totalRuns: total,
    avgDurationMs: Math.round(avgDuration._avg.durationMs ?? 0),
  };
}

export interface RunChartPoint {
  day: Date;
  started: number;
  failed: number;
  succeeded: number;
  total: number;
}

/**
 * Per-day run totals for the last N days, used by the overview chart. Statuses
 * outside {succeeded, failed} count toward neither column. Days are bucketed
 * in UTC consistently on both sides (SQL + JavaScript) to avoid timezone drift
 * between the query layer and the bucket generator.
 */
export async function getRunChartSeries(
  organizationId: string,
  days = 14,
): Promise<RunChartPoint[]> {
  const utcNow = new Date();
  const utcToday = Date.UTC(
    utcNow.getUTCFullYear(),
    utcNow.getUTCMonth(),
    utcNow.getUTCDate(),
  );
  const sinceMs = utcToday - (days - 1) * 86_400_000;

  const rows = await prisma.$queryRaw<Array<{ day: string; status: string; count: number }>>(
    Prisma.sql`
      SELECT to_char(date_trunc('day', ("created_at" AT TIME ZONE 'UTC')), 'YYYY-MM-DD') AS day,
             "status",
             COUNT(*)::int AS count
      FROM "workflow_runs"
      WHERE "organization_id" = ${organizationId} AND "created_at" >= to_timestamp(${sinceMs / 1000})
      GROUP BY 1, 2
      ORDER BY 1
    `,
  );

  const byDay = new Map<string, { y: number; s: number; f: number }>();
  for (const row of rows) {
    const entry = byDay.get(row.day) ?? { y: 0, s: 0, f: 0 };
    entry.y += row.count;
    if (row.status === "succeeded") entry.s += row.count;
    if (row.status === "failed") entry.f += row.count;
    byDay.set(row.day, entry);
  }

  const points: RunChartPoint[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(sinceMs + i * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    const entry = byDay.get(key);
    points.push({
      day,
      started: entry?.y ?? 0,
      succeeded: entry?.s ?? 0,
      failed: entry?.f ?? 0,
      total: entry?.y ?? 0,
    });
  }
  return points;
}

/** Flat run rows for CSV export (org-scoped, capped). */
export async function exportRuns(
  organizationId: string,
  options: { status?: string; workflowId?: string; limit?: number } = {},
): Promise<RunListItem[]> {
  const rows = await prisma.workflowRun.findMany({
    where: {
      organizationId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.workflowId ? { workflowId: options.workflowId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(50_000, Math.max(1, options.limit ?? 10_000)),
    select: {
      id: true,
      executionId: true,
      workflowId: true,
      workflow: { select: { name: true } },
      status: true,
      triggerType: true,
      durationMs: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    executionId: row.executionId,
    workflowId: row.workflowId,
    workflowName: row.workflow?.name ?? null,
    status: row.status,
    triggerType: row.triggerType,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  }));
}