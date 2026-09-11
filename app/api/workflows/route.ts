import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import {
  createWorkflow,
  listWorkflows,
} from "@/lib/data/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSessionFromRequest(request);
  const workflows = await listWorkflows(session.org);
  return NextResponse.json({ workflows });
}

const graphInputSchema = z.unknown();

export async function POST(request: Request) {
  const session = await requireSessionFromRequest(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = z
    .object({ name: z.string().trim().min(1).max(120), graph: graphInputSchema })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed.", details: parsed.error.flatten() }, { status: 400 });
  }

  const created = await createWorkflow(session.org, {
    name: parsed.data.name,
    graph: parsed.data.graph as never,
  }, session.sub);
  return NextResponse.json(created, { status: 201 });
}