import "server-only";

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

/**
 * Webhook signature verification (HMAC-SHA256).
 *
 * Schemes:
 *   - "relay"  : HMAC over `${timestamp}.${rawBody}`; timestamp reads from
 *                `x-relay-timestamp`, signature from `x-relay-signature` as
 *                `sha256=<hex>`. Replay-protected.
 *   - "github" : `x-hub-signature-256: sha256=<hex>` over the raw body
 *                (Stripe-style). No timestamps, so no replay window.
 *   - "stripe" : `stripe-signature: t=<timestamp>,v1=<hex>` over
 *                `${t}.${rawBody}`. Replay-protected.
 *
 * All comparisons run in constant time via timingSafeEqual.
 */

export type SignatureScheme = "relay" | "github" | "stripe";

export interface WebhookVerifyOptions {
  rawBody: string | Buffer;
  secret: string;
  signature?: string | null;
  timestamp?: string | null;
  scheme?: SignatureScheme;
  maxAgeSeconds?: number;
  nowSeconds?: number;
}

export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: "missing_signature" | "missing_timestamp" | "invalid_timestamp" | "expired" | "bad_signature" | "malformed" };

/** Constant-time hex comparison. Never throws. */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256 of the given buffer, hex-encoded. */
export function computeHmac(secret: string, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function parseHexValue(value: string): string {
  if (value.startsWith("sha256=")) {
    return value.slice("sha256=".length);
  }
  return value;
}

function isWithinWindow(
  timestampSeconds: number,
  maxAgeSeconds: number,
  nowSeconds: number,
): boolean {
  const age = nowSeconds - timestampSeconds;
  if (!Number.isFinite(age) || age < 0) {
    return false;
  }
  return age <= maxAgeSeconds;
}

/**
 * Verifies an incoming webhook delivery. Returns `ok: true` when the signature
 * matches AND (for timestamped schemes) the delivery is fresh.
 */
export function verifyWebhookSignature(
  options: WebhookVerifyOptions,
): VerificationResult {
  const {
    rawBody,
    secret,
    signature,
    timestamp,
    scheme = "relay",
    maxAgeSeconds = 300,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = options;

  if (typeof signature !== "string" || signature.length === 0) {
    return { ok: false, reason: "missing_signature" };
  }

  if (scheme === "github") {
    const received = parseHexValue(signature);
    const expected = computeHmac(secret, rawBody);
    return safeEqualHex(received, expected)
      ? { ok: true }
      : { ok: false, reason: "bad_signature" };
  }

  if (scheme === "stripe") {
    const pairs = new Map<string, string>();
    for (const part of signature.split(",")) {
      const eq = part.indexOf("=");
      if (eq > 0) {
        pairs.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
      }
    }
    const t = pairs.get("t");
    const v1 = pairs.get("v1");
    if (t === undefined || v1 === undefined) {
      return { ok: false, reason: "malformed" };
    }
    const ts = Number(t);
    if (!Number.isFinite(ts) || ts <= 0) {
      return { ok: false, reason: "invalid_timestamp" };
    }
    if (!isWithinWindow(ts, maxAgeSeconds, nowSeconds)) {
      return { ok: false, reason: "expired" };
    }
    const expected = computeHmac(secret, `${t}.${rawBody}`);
    return safeEqualHex(v1, expected)
      ? { ok: true }
      : { ok: false, reason: "bad_signature" };
  }

  // relay (default)
  if (typeof timestamp !== "string" || timestamp.length === 0) {
    return { ok: false, reason: "missing_timestamp" };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  if (!isWithinWindow(ts, maxAgeSeconds, nowSeconds)) {
    return { ok: false, reason: "expired" };
  }
  const received = parseHexValue(signature);
  const expected = computeHmac(secret, `${timestamp}.${rawBody}`);
  return safeEqualHex(received, expected)
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}