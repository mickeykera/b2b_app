import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import { listUserSessions, revokeSession } from "@/lib/data/sessions";
import { recordAudit } from "@/lib/audit";
import { extractClientIp } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSessionFromRequest(request);
  const rows = await listUserSessions(session.sub);
  return NextResponse.json({
    sessions: rows.map((row) => ({
      id: row.id,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      lastUsedAt: row.lastUsedAt,
      current: row.id === session.jti,
    })),
  });
}

const revokeSchema = z.object({
  sessionId: z.string().min(1),
});

export async function DELETE(request: Request) {
  const session = await requireSessionFromRequest(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = revokeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }
  const target = parsed.data.sessionId;
  if (target === session.jti) {
    return NextResponse.json({ error: "Use sign out to end the current session." }, { status: 400 });
  }
  const mine = await listUserSessions(session.sub);
  if (!mine.some((row) => row.id === target)) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  await revokeSession(target);
  await recordAudit({
    organizationId: session.org,
    actorId: session.sub,
    action: "sessions.revoked",
    resourceType: "session",
    resourceId: target,
    ipAddress: extractClientIp(request),
  });
  return NextResponse.json({ ok: true });
}