import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import { confirmMfa } from "@/lib/data/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(request: Request) {
  const session = await requireSessionFromRequest(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 6-digit code from your authenticator." }, { status: 400 });
  }
  const result = await confirmMfa(session.sub, parsed.data.code);
  if (!result.ok) {
    return NextResponse.json({ error: "That code was not accepted." }, { status: 401 });
  }
  return NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes });
}