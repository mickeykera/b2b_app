import {
  createHmac,
  randomBytes,
} from "node:crypto";

/**
 * Time-based One-Time Passwords (RFC 6238, HMAC-SHA1, 6 digits, 30s) used
 * for MFA enrollment and verification. Test vectors below follow RFC 6238.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ALGORITHM = "sha1";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const digit = BASE32_ALPHABET.indexOf(ch);
    if (digit === -1) {
      throw new Error("Invalid base32 character.");
    }
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function generateTotpCode(
  secretBase32: string,
  atMs: number = Date.now(),
  digits = TOTP_DIGITS,
): string {
  const key = decodeBase32(secretBase32);
  const counter = Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);

  const hmac = createHmac(TOTP_ALGORITHM, key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const value =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(value % 10 ** digits).padStart(digits, "0");
}

export function verifyTotpCode(
  secretBase32: string,
  code: string,
  atMs: number = Date.now(),
  window = 1,
): boolean {
  if (!/^\d{6}$/.test(code)) {
    return false;
  }
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = generateTotpCode(secretBase32, atMs + offset * TOTP_PERIOD_SECONDS * 1000);
    if (expected === code) {
      return true;
    }
  }
  return false;
}