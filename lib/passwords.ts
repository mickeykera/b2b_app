import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * Password hashing with Node's scrypt.
 *
 * Stored format: `scrypt$N$r$p$<saltBase64>$<hashBase64>`
 * Verifies with a constant-time comparison and re-derivation using the stored
 * parameters, so parameter upgrades don't invalidate existing hashes.
 */

export const SCRYPT_N = 16_384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 64;
export const SALT_BYTES = 16;

export class InvalidPasswordHashError extends Error {
  constructor(message = "Password hash is malformed.") {
    super(message);
    this.name = "InvalidPasswordHashError";
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new InvalidPasswordHashError();
  }
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    throw new InvalidPasswordHashError();
  }
  const salt = Buffer.from(saltB64 ?? "", "base64");
  const expected = Buffer.from(hashB64 ?? "", "base64");
  const actual = await scrypt(password, salt, expected.length, { N, r, p });
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}