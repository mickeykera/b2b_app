import { describe, expect, it } from "vitest";

import {
  computeHmac,
  safeEqualHex,
  verifyWebhookSignature,
} from "@/lib/sig";

const SECRET = "whsec_test_secret_0123456789abcdef";
const BODY = JSON.stringify({ id: "evt_123", amount: 100 });

describe("lib/sig · safeEqualHex", () => {
  it("accepts equal values", () => {
    expect(safeEqualHex("abcd", "abcd")).toBe(true);
    expect(safeEqualHex("", "")).toBe(false);
  });

  it("rejects different or malformed values", () => {
    expect(safeEqualHex("abcd", "abce")).toBe(false);
    expect(safeEqualHex("abcd", "abc")).toBe(false);
    expect(safeEqualHex("zz", "abcdef")).toBe(false);
  });
});

describe("lib/sig · relay scheme (timestamped)", () => {
  const now = Math.floor(Date.now() / 1000);
  const ts = String(now - 10);
  const sig = `sha256=${computeHmac(SECRET, `${ts}.${BODY}`)}`;

  it("accepts a fresh, correctly signed delivery", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: SECRET,
      signature: sig,
      timestamp: ts,
      scheme: "relay",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a signed delivery older than the max age (replay)", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: SECRET,
      signature: sig,
      timestamp: String(now - 301),
      scheme: "relay",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a future/clock-skewed timestamp", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: SECRET,
      signature: sig,
      timestamp: String(now + 60),
      scheme: "relay",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered body", () => {
    const result = verifyWebhookSignature({
      rawBody: JSON.stringify({ id: "evt_999", amount: 1 }),
      secret: SECRET,
      signature: sig,
      timestamp: ts,
      scheme: "relay",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects when the timestamp is missing", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: SECRET,
      signature: sig,
      scheme: "relay",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: "missing_timestamp" });
  });

  it("rejects invalid timestamps", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: SECRET,
      signature: sig,
      timestamp: "not-a-number",
      scheme: "relay",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_timestamp" });
  });

  it("rejects a missing signature", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: SECRET,
      signature: null,
      timestamp: ts,
      scheme: "relay",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: "missing_signature" });
  });

  it("rejects when the wrong secret is used", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: "attacker-secret",
      signature: sig,
      timestamp: ts,
      scheme: "relay",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("lib/sig · github scheme (x-hub-signature-256)", () => {
  const sig = `sha256=${computeHmac(SECRET, BODY)}`;

  it("accepts a correctly signed delivery", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: SECRET,
      signature: sig,
      scheme: "github",
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a body signed with the wrong secret", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: "wrong",
      signature: sig,
      scheme: "github",
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("lib/sig · stripe scheme (t=,v1=)", () => {
  const now = Math.floor(Date.now() / 1000);
  const t = String(now - 5);
  const v1 = computeHmac(SECRET, `${t}.${BODY}`);
  const sig = `t=${t},v1=${v1}`;

  it("accepts a fresh signed delivery", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: SECRET,
      signature: sig,
      scheme: "stripe",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects an expired delivery", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: SECRET,
      signature: `t=${now - 8000},v1=${v1}`,
      scheme: "stripe",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered payload", () => {
    const result = verifyWebhookSignature({
      rawBody: `${BODY}0`,
      secret: SECRET,
      signature: sig,
      scheme: "stripe",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("malformed header fails", () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      secret: SECRET,
      signature: "junk=blah",
      scheme: "stripe",
      maxAgeSeconds: 300,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});