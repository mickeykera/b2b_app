import "server-only";

import { SESSION_COOKIE_NAME, verifySession, type VerifiedSession } from "@/lib/jwt";
import { resolveLiveSession } from "@/lib/data/sessions";

/**
 * Request-level authentication helpers (no database access).
 *
 * Sessions can arrive via the session cookie (dashboard) or an
 * `Authorization: Bearer <jwt>` header (API clients).
 */

export class ApiAuthError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
  }
}

export function extractClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]!.trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}

export function parseSessionToken(cookieHeader: string | null | undefined): string | null {
  if (typeof cookieHeader !== "string") {
    return null;
  }
  const match = cookieHeader.split(";").find((part) => {
    const [name] = part.trim().split("=");
    return name === SESSION_COOKIE_NAME;
  });
  if (!match) {
    return null;
  }
  const value = match.trim().slice(SESSION_COOKIE_NAME.length + 1);
  return value || null;
}

export function extractBearerToken(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export async function getSessionFromRequest(
  request: Request,
): Promise<VerifiedSession | null> {
  const cookieToken = parseSessionToken(request.headers.get("cookie"));
  if (cookieToken) {
    const session = await verifySession(cookieToken);
    if (session && (await resolveLiveSession(session))) {
      return session;
    }
  }
  const bearer = extractBearerToken(request.headers.get("authorization"));
  if (bearer) {
    const session = await verifySession(bearer);
    if (session && (await resolveLiveSession(session))) {
      return session;
    }
  }
  return null;
}

/** Throws 401 when no valid session is present. */
export async function requireSessionFromRequest(
  request: Request,
): Promise<VerifiedSession> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    throw new ApiAuthError("Authentication required.", 401);
  }
  return session;
}