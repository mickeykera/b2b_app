import { NextResponse } from "next/server";

import { Queue } from "bullmq";

import { requireSessionFromRequest } from "@/lib/auth";
import { redis } from "@/lib/redis";
import { WORKFLOW_QUEUE_NAME } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Org-admin operational view of the shared execution queue. Returns live
 * BullMQ counters (waiting/active/delayed/failed/completed/…). Reads only —
 * data stays scoped by visibility, and downstream runs are still filtered per
 * organization before they reach the dashboard.
 */
export async function GET(request: Request) {
  const session = await requireSessionFromRequest(request);
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const queue = new Queue(WORKFLOW_QUEUE_NAME, { connection: redis });
  try {
    const [counts, schedulers, waiting, active] = await Promise.all([
      queue.getJobCounts(),
      queue.getJobSchedulers(),
      queue.getWaitingCount(),
      queue.getActiveCount(),
    ]);
    const schedulerCount = schedulers.filter((s) => s.key.startsWith("scr:")).length;
    return NextResponse.json({
      queue: WORKFLOW_QUEUE_NAME,
      organizationId: session.org,
      counts: {
        waiting: counts.waiting,
        active: counts.active,
        prioritized: counts.prioritized,
        delayed: counts.delayed,
        failed: counts.failed,
        completed: counts.completed,
        paused: counts.paused,
      },
      schedulerCount,
      live: { waiting, active },
      timestamp: new Date().toISOString(),
    });
  } catch (cause) {
    return NextResponse.json(
      { error: "Queue is unreachable.", detail: cause instanceof Error ? cause.message : "unknown" },
      { status: 503 },
    );
  } finally {
    await queue.close();
  }
}