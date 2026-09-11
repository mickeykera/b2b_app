import { NextResponse } from "next/server";

import { requireSessionFromRequest } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/data/runs";
import { enqueueWorkflowRun } from "@/lib/queue";
import { deriveExecutionId, newId } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const session = await requireSessionFromRequest(request);
  const { runId } = await params;
  const run = await getRun(session.org, runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  const eventId = newId("evt_");
  const occurredAtMs = Date.now();
  const executionId = deriveExecutionId(session.org, run.workflowId, eventId, occurredAtMs);

  await enqueueWorkflowRun({
    type: "retry",
    organizationId: session.org,
    workflowId: run.workflowId,
    executionId,
    event: {
      id: eventId,
      occurredAtMs,
      payload: run.eventPayload as Record<string, unknown>,
    },
  });

  await updateRun(session.org, run.id, { status: "retrying" });
  await recordAudit({
    organizationId: session.org,
    actorId: session.sub,
    action: "workflow.run_retried",
    resourceType: "workflow_run",
    resourceId: run.id,
    metadata: { executionId },
  });

  return NextResponse.json({ ok: true, run: executionId, queued: true });
}