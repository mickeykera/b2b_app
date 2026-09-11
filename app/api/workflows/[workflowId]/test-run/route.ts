import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import { getWorkflow } from "@/lib/data/workflows";
import { enqueueWorkflowRun } from "@/lib/queue";
import { deriveExecutionId, newId } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const testRunSchema = z.object({
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const session = await requireSessionFromRequest(request);
  const { workflowId } = await params;

  const workflow = await getWorkflow(session.org, workflowId);
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
  }

  let payload: Record<string, unknown> = {};
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = testRunSchema.safeParse(body);
  if (parsed.success) {
    payload = parsed.data.payload;
  }

  const eventId = newId("evt_");
  const occurredAtMs = Date.now();
  const executionId = deriveExecutionId(session.org, workflowId, eventId, occurredAtMs);

  await enqueueWorkflowRun({
    type: "manual",
    organizationId: session.org,
    workflowId,
    executionId,
    event: { id: eventId, occurredAtMs, payload },
  });

  return NextResponse.json({ ok: true, run: executionId, queued: true });
}