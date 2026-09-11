import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import { changePassword } from "@/lib/data/auth";
import { revokeAllUserSessionsExcept } from "@/lib/data/sessions";
import { recordAudit } from "@/lib/audit";
import { extractClientIp } from "@/lib/auth";
import { zPassword } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: zPassword,
});

export async function POST(request: Request) {
  const session = await requireSessionFromRequest(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const { currentPassword, newPassword } = parsed.data;
  const changed = await changePassword(session.sub, currentPassword, newPassword);
  if (!changed) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }
  await revokeAllUserSessionsExcept(session.sub, session.jti);
  await recordAudit({
    organizationId: session.org,
    actorId: session.sub,
    action: "password.changed",
    ipAddress: extractClientIp(request),
  });
  return NextResponse.json({ ok: true });
}