import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import { disableMfa } from "@/lib/data/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const disableSchema = z.object({
  password: z.string().min(1).max(1024),
});

export async function POST(request: Request) {
  const session = await requireSessionFromRequest(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }
  const disabled = await disableMfa(session.sub, parsed.data.password);
  if (!disabled) {
    return NextResponse.json({ error: "Password is incorrect." }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}