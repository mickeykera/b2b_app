import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import { getWorkflow, setWorkflowStatus } from "@/lib/data/workflows";
import { reconfigureWorkflowSchedule } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toggleSchema = z.object({ active: z.boolean() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const session = await requireSessionFromRequest(request);
  const { workflowId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed." }, { status: 400 });
  }

  const workflow = await getWorkflow(session.org, workflowId);
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
  }

  try {
    await setWorkflowStatus(session.org, workflowId, parsed.data.active ? "active" : "paused", session.sub);
  } catch (cause) {
    return NextResponse.json({ error: (cause as Error).message }, { status: 400 });
  }

  if (parsed.data.active && workflow.graph) {
    await reconfigureWorkflowSchedule(
      session.org,
      workflowId,
      workflow.graph as unknown as { nodes: unknown[] },
    ).catch((cause) => console.error("[toggle] scheduler reconfigure failed", cause));
  }

  return NextResponse.json({ id: workflowId, status: parsed.data.active ? "active" : "paused" });
}