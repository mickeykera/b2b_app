import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import {
  deleteWorkflow,
  getWorkflow,
  updateWorkflow,
} from "@/lib/data/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const saveWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1_000).optional().or(z.null()),
  graph: z.unknown(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const session = await requireSessionFromRequest(request);
  const { workflowId } = await params;
  const workflow = await getWorkflow(session.org, workflowId);
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
  }
  return NextResponse.json({ workflow });
}

export async function PATCH(
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
  const parsed = saveWorkflowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed.", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await updateWorkflow(
    session.org,
    workflowId,
    {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      graph: parsed.data.graph as never,
    },
    session.sub,
  ).catch((cause) => ({
    error: (cause as Error).message,
  }));

  if ("error" in updated) {
    return NextResponse.json({ error: updated.error }, { status: 400 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const session = await requireSessionFromRequest(request);
  const { workflowId } = await params;
  try {
    await deleteWorkflow(session.org, workflowId, session.sub);
  } catch (cause) {
    return NextResponse.json({ error: (cause as Error).message }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}