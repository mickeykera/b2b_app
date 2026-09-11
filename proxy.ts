import { NextResponse, type NextRequest } from "next/server";

import { verifySession } from "@/lib/jwt";
import { resolveLiveSession } from "@/lib/data/sessions";
import { parseSessionToken } from "@/lib/auth";
import { createRequestId } from "@/lib/logger";

/**
 * App Router proxy (Next 16 replacement for middleware.ts).
 *
 * Guards the dashboard surface: unauthenticated visitors are redirected to
 * /login; signed-in users visiting /login are sent to the overview.
 *
 * API routes authenticate themselves and are intentionally excluded here so
 * that machine clients (Bearer tokens) are never cookie-redirected.
 *
 * Also stamps an `x-request-id` on every response (generating one when the
 * caller did not provide it) so logs from proxy, app, and worker can be
 * correlated.
 */

const PUBLIC_PATHS = new Set(["/login", "/forgot", "/reset"]);
const PUBLIC_PREFIXES = ["/invite"];
const API_PREFIX = "/api";
const STATIC_PREFIXES = ["/_next/", "/_static/", "/favicon.ico", "/robots.txt", "/manifest"];

function withRequestId(request: NextRequest, response: NextResponse): NextResponse {
  const requestId = request.headers.get("x-request-id") ?? createRequestId();
  request.headers.set("x-request-id", requestId);
  response.headers.set("x-request-id", requestId);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith(API_PREFIX) ||
    STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return withRequestId(request, NextResponse.next());
  }

  const token = parseSessionToken(request.headers.get("cookie"));
  const session = token ? await verifySession(token) : null;
  const live = session ? await resolveLiveSession(session) : null;

  const isPublic =
    PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!live && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return withRequestId(request, NextResponse.redirect(loginUrl));
  }

  if (live && pathname === "/login") {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/";
    dashboardUrl.search = "";
    return withRequestId(request, NextResponse.redirect(dashboardUrl));
  }

  return withRequestId(request, NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};