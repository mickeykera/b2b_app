import "server-only";

import { cookies } from "next/headers";

import { parseSessionToken } from "@/lib/auth";
import { verifySession, type VerifiedSession } from "@/lib/jwt";
import { resolveLiveSession } from "@/lib/data/sessions";

/**
 * Server-component session helpers (dashboard pages, App Router).
 * Next 16 requires `cookies()` to be awaited (async request APIs).
 */

export async function getPageSession(): Promise<VerifiedSession | null> {
  const store = await cookies();
  const token = parseSessionToken(store.toString());
  if (!token) {
    return null;
  }
  const session = await verifySession(token);
  if (!session || !(await resolveLiveSession(session))) {
    return null;
  }
  return session;
}

export async function requirePageSession(): Promise<VerifiedSession> {
  const session = await getPageSession();
  if (!session) {
    throw new Error("DashboardSessionRequired");
  }
  return session;
}