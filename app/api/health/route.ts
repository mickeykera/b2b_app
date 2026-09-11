import { NextResponse } from "next/server";

import { pingDatabase } from "@/lib/db";
import { pingRedis } from "@/lib/redis";
import { requestLogger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const log = requestLogger(request);
  let db = "ok";
  let cache = "ok";

  try {
    await pingDatabase();
  } catch (cause) {
    log.error("health db check failed", { component: "db", error: cause });
    db = "down";
  }
  try {
    await pingRedis();
  } catch (cause) {
    log.error("health redis check failed", { component: "redis", error: cause });
    cache = "down";
  }

  const healthy = db === "ok" && cache === "ok";
  const response = NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      db,
      cache,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
  response.headers.set("x-request-id", request.headers.get("x-request-id") ?? "");
  return response;
}