import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Secret encryption at rest.
 *
 * Design:
 *   - Master key: `MASTER_ENCRYPTION_KEY` (base64, 32 bytes) from env.
 *   - Tenant key: HKDF-SHA256 derived per-tenant from the master key using a
 *     deterministic per-organization salt. A secret encrypted under tenant A
 *     can never be decrypted with tenant B's derived key.
 *   - Cipher: AES-256-GCM (authenticated). A fresh 96-bit IV is generated for
 *     every encryption and stored alongside the ciphertext.
 *
 * Ciphertext envelope (URL-safe base64 segments):
 *   v1:<iv><.><authTag><.><ciphertext>
 */

export const CIPHER_VERSION = "v1" as const;
export const CIPHER_ALGORITHM = "aes-256-gcm" as const;

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const CRYPTO_INFO = Buffer.from("relayflow:secret:v1", "utf8");
const KDF_SALT_PREFIX = "relayflow:org:";

export class SecretEncryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SecretEncryptionError";
  }
}

/** Errors raised when a stored secret can't be decoded/decrypted. */
export class SecretDecryptionError extends SecretEncryptionError {}

/**
 * Decodes + validates the master encryption key.
 * Defaults to `env.MASTER_ENCRYPTION_KEY`; the optional override exists for
 * tests and key-rotation tooling.
 */
export function resolveMasterKey(
  value?: string | Buffer,
): Buffer {
  const source = value ?? process.env.MASTER_ENCRYPTION_KEY;
  if (!source) {
    throw new SecretEncryptionError(
      "MASTER_ENCRYPTION_KEY is not configured. Refusing to encrypt secrets.",
    );
  }
  const raw = Buffer.isBuffer(source) ? source : Buffer.from(source, "base64");
  if (raw.length !== KEY_LENGTH) {
    throw new SecretEncryptionError(
      `MASTER_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes; got ${raw.length}.`,
    );
  }
  return raw;
}

function kdfSalt(organizationId: string): Buffer {
  return createHash("sha256")
    .update(KDF_SALT_PREFIX + organizationId, "utf8")
    .digest();
}

/**
 * Derives the tenant-scoped AES-256 key from the master key.
 * Deterministic: repeated calls for the same org return the same key.
 */
export function deriveTenantKey(
  masterKey: string | Buffer,
  organizationId: string,
): Buffer {
  const ikm = resolveMasterKey(masterKey);
  return Buffer.from(
    hkdfSync("sha256", ikm, kdfSalt(organizationId), CRYPTO_INFO, KEY_LENGTH),
  );
}

export function generateWebhookSecret(size = 32): string {
  return randomBytes(size).toString("base64url");
}

/**
 * Encrypts a UTF-8 secret for a tenant. Returns the versioned envelope string.
 * Throws `SecretEncryptionError` if the master key is misconfigured.
 */
export function encryptSecret(
  organizationId: string,
  plaintext: string,
  masterKey?: string | Buffer,
): string {
  if (organizationId.length === 0) {
    throw new SecretEncryptionError("organizationId must not be empty.");
  }
  const key = deriveTenantKey(masterKey ?? process.env.MASTER_ENCRYPTION_KEY!, organizationId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    CIPHER_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/**
 * Decrypts a versioned envelope. Fails (without leaking length/timing beyond
 * the GCM tag check) when the payload was tampered with, the tenant key
 * differs, or the format is invalid.
 */
export function decryptSecret(
  organizationId: string,
  envelope: string,
  masterKey?: string | Buffer,
): string {
  const segments = envelope.split(":");
  if (segments.length !== 4 || segments[0] !== CIPHER_VERSION) {
    throw new SecretDecryptionError("Unsupported or malformed secret envelope.");
  }
  const [, ivB64, tagB64, ciphertextB64] = segments;
  let iv: Buffer;
  let tag: Buffer;
  let ciphertext: Buffer;
  try {
    iv = Buffer.from(ivB64!, "base64url");
    tag = Buffer.from(tagB64!, "base64url");
    ciphertext = Buffer.from(ciphertextB64!, "base64url");
  } catch {
    throw new SecretDecryptionError("Secret envelope contains invalid base64.");
  }
  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new SecretDecryptionError("Secret envelope has invalid lengths.");
  }

  const key = deriveTenantKey(masterKey ?? process.env.MASTER_ENCRYPTION_KEY!, organizationId);
  const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (cause) {
    throw new SecretDecryptionError(
      "Decryption failed: authentication tag mismatch (tampered data or wrong tenant key).",
      { cause },
    );
  }
}

/**
 * Masks a secret for display/masked storage. Keeps the last 4 chars.
 */
export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "•".repeat(Math.min(value.length, 6));
  }
  return `${"•".repeat(8)}${value.slice(-4)}`;
}