import "server-only";

import { env } from "@/lib/env";
import { redis } from "@/lib/redis";

/**
 * Token-bucket rate limiting on Redis.
 *
 * Each bucket = HASH key { tokens, ts }. The Lua script atomically refills the
 * bucket at `refillPerMinute / 60` tokens per second (capped at capacity),
 * consumes one token if available, and returns the decision + remaining tokens
 * so callers can emit accurate `X-RateLimit-*` headers.
 */

const TOKEN_BUCKET_SCRIPT = `
local capacity = tonumber(ARGV[1])
local refillPerSec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local current = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(current[1])
local ts = tonumber(current[2])
if tokens == nil then
  tokens = capacity
  ts = now
end
local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * refillPerSec)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
local ttl = math.ceil(capacity / math.max(refillPerSec, 0.0001)) + 1
redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', KEYS[1], ttl)
return {allowed, tokens}
`;

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface Bucket {
  key: string;
  capacity: number;
  refillPerMinute: number;
}

export function ipBucket(ip: string): Bucket {
  return {
    key: `rl:ip:${ip}`,
    capacity: env.RATE_LIMIT_IP_CAPACITY,
    refillPerMinute: env.RATE_LIMIT_IP_REFILL_PER_MINUTE,
  };
}

export function tenantBucket(organizationId: string, scope = "default"): Bucket {
  return {
    key: `rl:org:${organizationId}:${scope}`,
    capacity: env.RATE_LIMIT_ORG_CAPACITY,
    refillPerMinute: env.RATE_LIMIT_ORG_REFILL_PER_MINUTE,
  };
}

export function webhookBucket(endpointSlug: string): Bucket {
  return {
    key: `rl:webhook:${endpointSlug}`,
    capacity: env.RATE_LIMIT_WEBHOOK_CAPACITY,
    refillPerMinute: env.RATE_LIMIT_WEBHOOK_REFILL_PER_MINUTE,
  };
}

export async function consumeBucket(bucket: Bucket, nowMs = Date.now()): Promise<RateLimitDecision> {
  const refillPerSec = bucket.refillPerMinute / 60_000;
  const [allowedRaw, remainingRaw] = (await redis.eval(
    TOKEN_BUCKET_SCRIPT,
    1,
    bucket.key,
    bucket.capacity,
    refillPerSec,
    nowMs,
  )) as [number, number];

  const allowed = allowedRaw === 1;
  const remaining = Math.floor(remainingRaw);
  const retryAfterSeconds = remaining > 0 ? 0 : Math.ceil(60_000 / Math.max(refillPerSec, 0.0001) / 1000);
  return { allowed, remaining, retryAfterSeconds };
}

/** Convenience for route handlers: consume multiple buckets at once. */
export async function enforceBuckets(
  buckets: Bucket[],
): Promise<{ ok: true } | { ok: false; decision: RateLimitDecision }> {
  for (const bucket of buckets) {
    const decision = await consumeBucket(bucket);
    if (!decision.allowed) {
      return { ok: false, decision };
    }
  }
  return { ok: true };
}