import { NextResponse } from "next/server";

import { z } from "zod";

import { consumePasswordReset } from "@/lib/data/auth";
import { recordAudit } from "@/lib/audit";
import { extractClientIp } from "@/lib/auth";
import { zPassword } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resetSchema = z.object({
  token: z.string().min(20),
  password: zPassword,
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const applied = await consumePasswordReset(parsed.data.token, parsed.data.password);
  if (!applied) {
    return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }
  await recordAudit({
    organizationId: applied.organizationId,
    actorId: applied.userId,
    action: "auth.password_reset_completed",
    ipAddress: extractClientIp(request),
  });
  return NextResponse.json({ ok: true });
}