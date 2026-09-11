import "server-only";

import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { issueSession, type SessionPayload } from "@/lib/jwt";

/**
 * Revocable server-side sessions.
 *
 * A session is a DB row keyed by a SHA-256 hash of its id. The id travels as
 * the `jti` claim inside the HS256 JWT handed to the client. Every session
 * verification resolves the jti against the DB, so logout, password changes,
 * and admin revocation take effect immediately — a leaked token cannot outlive
 * its row.
 */

function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

export interface SessionContext {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  ttlDays?: number;
}

/**
 * Records a session row and returns a signed JWT whose `jti` is the session id.
 */
export async function issueSessionToken(
  principal: SessionPayload,
  context: SessionContext,
): Promise<string> {
  const ttlDays = context.ttlDays ?? 7;
  const sessionId = newId("ses_");
  await prisma.session.create({
    data: {
      id: sessionId,
      userId: context.userId,
      tokenHash: hashSessionId(sessionId),
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
    },
  });
  return issueSession(
    { ...principal, jti: sessionId },
    { daysToLive: ttlDays },
  );
}

export interface LiveSession {
  id: string;
  userId: string;
  expiresAt: Date;
}

/**
 * Resolves a verified JWT to a live session row. A token whose row is missing,
 * revoked, expired, or bound to a different user is treated as dead.
 */
export async function resolveLiveSession(
  principal: { sub: string; jti?: string | null },
): Promise<LiveSession | null> {
  if (!principal.jti) {
    return null;
  }
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionId(principal.jti) },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true },
  });
  if (!session) {
    return null;
  }
  const now = new Date();
  if (session.userId !== principal.sub) {
    return null;
  }
  if (session.revokedAt && session.revokedAt <= now) {
    return null;
  }
  if (session.expiresAt <= now) {
    return null;
  }
  return { id: session.id, userId: session.userId, expiresAt: session.expiresAt };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashSessionId(sessionId), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every session for a user except the given one (used on password change). */
export async function revokeAllUserSessionsExcept(
  userId: string,
  keepSessionId?: string | null,
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function listUserSessions(userId: string): Promise<
  Array<{ id: string; ipAddress: string | null; userAgent: string | null; expiresAt: Date; revokedAt: Date | null; lastUsedAt: Date; createdAt: Date }>
> {
  return prisma.session.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
}

/** Soft-deletes sessions that expired long ago so the table stays bounded. */
export async function pruneExpiredSessions(holderDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - holderDays * 86_400_000);
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}