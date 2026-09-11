import { NextResponse } from "next/server";

import { requireSessionFromRequest } from "@/lib/auth";
import { getRun } from "@/lib/data/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const session = await requireSessionFromRequest(request);
  const { runId } = await params;
  const run = await getRun(session.org, runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  return NextResponse.json({ run });
}