import { NextResponse } from "next/server";

import { z } from "zod";
import { createHash } from "node:crypto";

import { authenticateUser } from "@/lib/data/auth";
import { buildSessionCookie } from "@/lib/jwt";
import { issueSessionToken } from "@/lib/data/sessions";
import { consumeBucket } from "@/lib/ratelimit";
import { recordAudit } from "@/lib/audit";
import { extractClientIp } from "@/lib/auth";
import { requestLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
  mfaCode: z.string().regex(/^\d{6}$/).optional().or(z.literal("")),
});

/**
 * Token buckets on mail + IP to slow credential stuffing. The limiter fails
 * open if Redis is unreachable so a cache outage cannot lock every user out.
 * Returns the retry-after window (seconds) when throttled, else 0.
 */
async function enforceLoginRateLimit(email: string, ip: string): Promise<number> {
  const emailHash = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
  const buckets = [
    { key: `rl:auth:ip:${ip}`, capacity: 20, refillPerMinute: 10 },
    { key: `rl:auth:email:${emailHash}`, capacity: 5, refillPerMinute: 5 },
  ];
  let longestLock = 0;
  for (const bucket of buckets) {
    try {
      const decision = await consumeBucket(bucket);
      if (!decision.allowed) {
        longestLock = Math.max(longestLock, decision.retryAfterSeconds);
      }
    } catch {
      // fail open; authentication itself still enforces credentials
    }
  }
  return longestLock;
}

export async function POST(request: Request) {
  const log = requestLogger(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid credentials format.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { email, password, mfaCode } = parsed.data;
  const ip = extractClientIp(request);

  const lockedFor = await enforceLoginRateLimit(email, ip);
  if (lockedFor > 0) {
    log.warn("login throttled", { retryAfterSeconds: lockedFor, ip });
    const response = NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429 },
    );
    response.headers.set("Retry-After", String(lockedFor));
    return response;
  }

  const outcome = await authenticateUser(email, password, mfaCode || undefined);

  if (outcome.status === "invalid_credentials") {
    await recordAudit({
      organizationId: null,
      action: "auth.login_failed",
      ipAddress: ip,
      metadata: { email: email.toLowerCase() },
    });
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const principal = outcome.principal;
  const response = NextResponse.json(
    outcome.status === "mfa_required"
      ? { status: "mfa_required" }
      : { status: "ok", user: { id: principal.userId, email: principal.email, role: principal.role } },
    { status: 200 },
  );

  if (outcome.status === "ok") {
    const token = await issueSessionToken(
      {
        sub: principal.userId,
        org: principal.organizationId,
        role: principal.role,
        email: principal.email,
        name: principal.name,
      },
      {
        userId: principal.userId,
        ipAddress: ip,
        userAgent: request.headers.get("user-agent"),
      },
    );
    response.headers.append("Set-Cookie", buildSessionCookie(token));
    await recordAudit({
      organizationId: principal.organizationId,
      actorId: principal.userId,
      action: "auth.login",
      ipAddress: ip,
      metadata: { email: principal.email },
    });
    log.info("login succeeded", { org: principal.organizationId, user: principal.userId });
  }

  return response;
}