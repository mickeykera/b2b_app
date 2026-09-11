import { NextResponse } from "next/server";

import { buildClearSessionCookie } from "@/lib/jwt";
import { getSessionFromRequest, extractClientIp } from "@/lib/auth";
import { revokeSession } from "@/lib/data/sessions";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  const response = NextResponse.json({ ok: true });
  response.headers.append("Set-Cookie", buildClearSessionCookie());
  if (session) {
    if (session.jti) {
      await revokeSession(session.jti);
    }
    await recordAudit({
      organizationId: session.org,
      actorId: session.sub,
      action: "auth.logout",
      ipAddress: extractClientIp(request),
    });
  }
  return response;
}