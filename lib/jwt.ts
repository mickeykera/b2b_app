import "server-only";

import { jwtVerify, SignJWT } from "jose";

import { env } from "@/lib/env";

/**
 * Stateless session tokens (HS256 JWTs).
 *
 * Sessions are issued at login, verified by the request proxy and API route
 * helpers, and invalidated client-side on logout (revocation for breached
 * sessions is handled by re-issuing on password change).
 */

export const SESSION_COOKIE_NAME = "__relayflow_session";

export interface SessionPayload {
  sub: string;
  org: string;
  role: "admin" | "member";
  email: string;
  name?: string | null;
  jti?: string | null;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.AUTH_JWT_SECRET);
}

export interface IssueSessionOptions {
  daysToLive?: number;
  now?: Date;
}

export async function issueSession(
  payload: SessionPayload,
  options: IssueSessionOptions = {},
): Promise<string> {
  const { daysToLive = env.AUTH_SESSION_TTL_DAYS, now = new Date() } = options;
  const secret = secretKey();
  const token = await new SignJWT({
    org: payload.org,
    role: payload.role,
    email: payload.email,
    name: payload.name ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setJti(payload.jti ?? "")
    .setIssuedAt(now)
    .setIssuer("relayflow")
    .setAudience("relayflow:dashboard")
    .setExpirationTime(Math.floor(now.getTime() / 1000) + daysToLive * 86_400)
    .sign(secret);
  return token;
}

export interface VerifiedSession extends SessionPayload {
  exp: number;
  iat: number;
}

export async function verifySession(token: string): Promise<VerifiedSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: "relayflow",
      audience: "relayflow:dashboard",
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || typeof payload.org !== "string") {
      return null;
    }
    const role = payload.role === "admin" ? "admin" : "member";
    return {
      sub: payload.sub,
      org: payload.org,
      role,
      email: String(payload.email ?? ""),
      name: payload.name ? String(payload.name) : null,
      jti: typeof payload.jti === "string" && payload.jti.length > 0 ? payload.jti : null,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}

export function sessionCookieAttributes(maxAgeDays = env.AUTH_SESSION_TTL_DAYS): string {
  const attrs = [
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeDays * 86_400}`,
  ];
  if (env.NODE_ENV === "production") {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

export function buildSessionCookie(token: string, maxAgeDays?: number): string {
  return `${SESSION_COOKIE_NAME}=${token}; ${sessionCookieAttributes(maxAgeDays)}`;
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}