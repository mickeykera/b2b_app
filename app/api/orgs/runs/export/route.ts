import { NextResponse } from "next/server";

import { requireSessionFromRequest } from "@/lib/auth";
import { exportRuns } from "@/lib/data/runs";
import { toCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUS = new Set([
  "queued",
  "started",
  "succeeded",
  "failed",
  "retrying",
  "filtered",
]);

/** Download a CSV export of the workspace's runs (respects the run list filters). */
export async function GET(request: Request) {
  const session = await requireSessionFromRequest(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const workflowId = url.searchParams.get("workflowId") ?? undefined;
  if (status !== undefined && !ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ error: "Unknown run status filter." }, { status: 400 });
  }

  const rows = await exportRuns(session.org, { status, workflowId });
  const flat = rows.map((row) => ({
    executionId: row.executionId,
    workflow: row.workflowName ?? row.workflowId,
    status: row.status,
    trigger: row.triggerType ?? "",
    durationSeconds: row.durationMs !== null ? (row.durationMs / 1000).toFixed(3) : "",
    startedAtUtc: row.createdAt.toISOString(),
  }));

  const filename = `runs-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(toCsv(flat), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}