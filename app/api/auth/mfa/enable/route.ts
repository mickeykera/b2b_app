import { NextResponse } from "next/server";

import { requireSessionFromRequest } from "@/lib/auth";
import { enrollMfa } from "@/lib/data/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireSessionFromRequest(request);
  const { secret } = await enrollMfa(session.sub);
  const issuer = encodeURIComponent(env.APP_NAME);
  const account = encodeURIComponent(session.email);
  return NextResponse.json({
    secret,
    otpauthUrl: `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
  });
}