import "server-only";

import Redis from "ioredis";

import { env } from "@/lib/env";

/**
 * Shared Redis connections.
 *
 * BullMQ and the token-bucket rate limiter share `defaultRedis`. All
 * connections are lazily created so modules can be imported without
 * instantiating a socket (tests remain offline).
 */

declare global {
  var __relayflowRedis: Redis | undefined;
}

function create(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 3_000),
  });
}

function getRedis(): Redis {
  if (process.env.NODE_ENV !== "production") {
    globalThis.__relayflowRedis ??= create();
    return globalThis.__relayflowRedis;
  }
  return create();
}

export const redis = getRedis();

export async function pingRedis(): Promise<void> {
  await redis.connect();
  await redis.ping();
}

export async function closeRedis(): Promise<void> {
  if (globalThis.__relayflowRedis) {
    await globalThis.__relayflowRedis.quit();
    globalThis.__relayflowRedis = undefined;
  }
}