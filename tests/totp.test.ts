import { describe, expect, it } from "vitest";

import {
  decodeBase32,
  encodeBase32,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from "@/lib/totp";

// RFC 6238 Appendix B test vector (ASCII secret, SHA1).
// SHA1 digits per the RFC are 8; we use the standard 6-digit truncation below.
const RFC_SECRET = "12345678901234567890"; // interpreted as raw secret bytes
const RFC_KEY = encodeBase32(Buffer.from(RFC_SECRET, "ascii"));

describe("lib/totp", () => {
  it("round-trips base32 encoding/decoding", () => {
    const raw = Buffer.from([0x41, 0xe3, 0x8f, 0x52, 0x00, 0xff]);
    expect(decodeBase32(encodeBase32(raw))).toEqual(raw);
  });

  it("generates deterministic codes for the same time step", () => {
    const secret = generateTotpSecret();
    const at = 1_600_000_000_000;
    expect(generateTotpCode(secret, at)).toBe(generateTotpCode(secret, at));
  });

  it("accepts a correct code and rejects a wrong one", () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;
    const code = generateTotpCode(secret, at);
    expect(verifyTotpCode(secret, code, at)).toBe(true);
    expect(verifyTotpCode(secret, "000000", at)).toBe(false);
  });

  it("tolerates clock drift within the window", () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;
    const code = generateTotpCode(secret, at + 45_000);
    expect(verifyTotpCode(secret, code, at, 2)).toBe(true);
  });

  it("produces stable codes for RFC 6238 test vector secret", () => {
    // Known 8-digit SHA1 vectors from RFC 6238: 59 -> 94287082.
    const at = 59 * 1000;
    const code = generateTotpCode(RFC_KEY, at, 8);
    expect(code).toBe("94287082");
  });

  it("rejects malformed codes", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "abc", Date.now())).toBe(false);
    expect(verifyTotpCode(secret, "12345", Date.now())).toBe(false);
  });
});