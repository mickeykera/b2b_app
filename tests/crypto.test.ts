import { describe, expect, it } from "vitest";

import {
  SecretDecryptionError,
  SecretEncryptionError,
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
  maskSecret,
  resolveMasterKey,
} from "@/lib/crypto";

const MASTER = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const ORG_A = "org_aaaaaaaaaaaaaaaaaaaaaaa";
const ORG_B = "org_bbbbbbbbbbbbbbbbbbbbbbb";

describe("lib/crypto", () => {
  it("decodes a 32-byte master key", () => {
    const key = resolveMasterKey(MASTER);
    expect(key.length).toBe(32);
  });

  it("rejects a master key that is not 32 bytes", () => {
    expect(() => resolveMasterKey(Buffer.from("short"))).toThrow(
      SecretEncryptionError,
    );
  });

  it("round-trips a secret for the same tenant", () => {
    const envelope = encryptSecret(ORG_A, "sk-secret-token-1234", MASTER);
    expect(envelope.startsWith("v1:")).toBe(true);
    expect(decryptSecret(ORG_A, envelope, MASTER)).toBe("sk-secret-token-1234");
  });

  it("produces a unique IV on every encryption (different envelopes)", () => {
    const a = encryptSecret(ORG_A, "same", MASTER);
    const b = encryptSecret(ORG_A, "same", MASTER);
    expect(a).not.toBe(b);
    expect(decryptSecret(ORG_A, a, MASTER)).toBe("same");
    expect(decryptSecret(ORG_A, b, MASTER)).toBe("same");
  });

  it("cannot decrypt with a different tenant key (tenant isolation)", () => {
    const envelope = encryptSecret(ORG_A, "scoped-secret", MASTER);
    expect(() => decryptSecret(ORG_B, envelope, MASTER)).toThrow(
      SecretDecryptionError,
    );
  });

  it("cannot decrypt with a different master key", () => {
    const envelope = encryptSecret(ORG_A, "secret", MASTER);
    const otherMaster = Buffer.from("fedcba9876543210fedcba9876543210", "utf8");
    expect(() => decryptSecret(ORG_A, envelope, otherMaster)).toThrow(
      SecretDecryptionError,
    );
  });

  it("detects tampering of the ciphertext", () => {
    const envelope = encryptSecret(ORG_A, "tamper-sensitive", MASTER);
    const segments = envelope.split(":");
    const ciphertext = Buffer.from(segments[3]!, "base64url");
    const mid = Math.floor(ciphertext.length / 2);
    ciphertext[mid] = (ciphertext[mid] ?? 0) ^ 0x01;
    const tampered = [
      segments[0],
      segments[1],
      segments[2],
      ciphertext.toString("base64url"),
    ].join(":");
    expect(tampered).not.toBe(envelope);
    expect(() => decryptSecret(ORG_A, tampered, MASTER)).toThrow(
      SecretDecryptionError,
    );
  });

  it("detects tampering of the auth tag", () => {
    const envelope = encryptSecret(ORG_A, "secret", MASTER);
    const segments = envelope.split(":");
    const tag = segments[2]!;
    const flipped = tag.slice(0, 4) + (tag[4] === "A" ? "B" : "A") + tag.slice(5);
    const tampered = [segments[0], segments[1], flipped, segments[3]].join(":");
    expect(tampered).not.toBe(envelope);
    expect(() => decryptSecret(ORG_A, tampered, MASTER)).toThrow(
      SecretDecryptionError,
    );
  });

  it("rejects empty organization ids", () => {
    expect(() => encryptSecret("", "secret", MASTER)).toThrow(
      SecretEncryptionError,
    );
  });

  it("rejects malformed envelopes", () => {
    expect(() => decryptSecret(ORG_A, "garbage", MASTER)).toThrow(
      SecretDecryptionError,
    );
    expect(() => decryptSecret(ORG_A, "v1:---:", MASTER)).toThrow(
      SecretDecryptionError,
    );
    expect(() => decryptSecret(ORG_A, "v2:aa:bb:cc", MASTER)).toThrow(
      SecretDecryptionError,
    );
  });

  it("supports unicode plaintext", () => {
    const envelope = encryptSecret(ORG_A, "héllo → 世界 · payload {\"x\":1}", MASTER);
    expect(decryptSecret(ORG_A, envelope, MASTER)).toBe("héllo → 世界 · payload {\"x\":1}");
  });

  it("generates URL-safe webhook secrets", () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it("masks values keeping only the trailing four characters", () => {
    expect(maskSecret("sk_live_abc")).toBe("•".repeat(8) + "_abc");
    expect(maskSecret("abcdefgh")).toBe("••••••");
  });
});