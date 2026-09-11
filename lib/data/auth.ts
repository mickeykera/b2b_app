import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/db";
import { Prisma } from "@/src/generated/prisma/client";
import { env } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { generateTotpSecret, verifyTotpCode } from "@/lib/totp";
import { recordAudit } from "@/lib/audit";

export interface AuthenticatedPrincipal {
  userId: string;
  organizationId: string;
  role: "admin" | "member";
  email: string;
  name?: string | null;
}

export type LoginOutcome =
  | { status: "ok"; principal: AuthenticatedPrincipal }
  | { status: "mfa_required"; principal: AuthenticatedPrincipal }
  | { status: "invalid_credentials" };

/**
 * Verifies email+password and, when MFA is enabled, the TOTP code.
 * Uses generalized constant-time password verification (scrypt).
 */
export async function authenticateUser(
  email: string,
  password: string,
  mfaCode?: string,
): Promise<LoginOutcome> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: {
      id: true,
      organizationId: true,
      email: true,
      name: true,
      role: true,
      passwordHash: true,
      mfaEnabled: true,
      mfaSecretEncrypted: true,
      recoveryCodesHash: true,
      lastLoginAt: true,
    },
  });
  if (!user) {
    return { status: "invalid_credentials" };
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    return { status: "invalid_credentials" };
  }

  const principal: AuthenticatedPrincipal = {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role === "admin" ? "admin" : "member",
    email: user.email,
    name: user.name,
  };

  if (user.mfaEnabled) {
    if (typeof mfaCode !== "string" || mfaCode.length === 0) {
      return { status: "mfa_required", principal };
    }
    if (!user.mfaSecretEncrypted) {
      return { status: "invalid_credentials" };
    }
    let secret: string;
    try {
      secret = decryptSecret(user.organizationId, user.mfaSecretEncrypted);
    } catch {
      return { status: "invalid_credentials" };
    }
    if (!verifyTotpCode(secret, mfaCode)) {
      const recoveryHash = hashRecoveryCode(normalizeRecoveryCode(mfaCode));
      const hashes = (user.recoveryCodesHash ?? []) as string[];
      const index = hashes.indexOf(recoveryHash);
      if (index === -1) {
        return { status: "invalid_credentials" };
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { recoveryCodesHash: hashes.filter((_, i) => i !== index) },
      });
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { status: "ok", principal };
}

/** Enrolls MFA for a user, returning the raw base32 secret once. */
export async function enrollMfa(userId: string): Promise<{ secret: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, organizationId: true },
  });
  const secret = generateTotpSecret();
  const encrypted = encryptSecret(user.organizationId, secret);
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaSecretEncrypted: encrypted, mfaEnabled: false },
  });
  return { secret };
}

export async function confirmMfa(userId: string, code: string): Promise<{
  ok: boolean;
  recoveryCodes?: string[];
}> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, organizationId: true, mfaSecretEncrypted: true },
  });
  if (!user.mfaSecretEncrypted) {
    return { ok: false };
  }
  const secret = decryptSecret(user.organizationId, user.mfaSecretEncrypted);
  if (!verifyTotpCode(secret, code)) {
    return { ok: false };
  }
  const recoveryCodes = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      mfaEnabled: true,
      recoveryCodesHash: recoveryCodes.map(hashRecoveryCode),
    },
  });
  await recordAudit({
    organizationId: user.organizationId,
    actorId: user.id,
    action: "mfa.enabled",
    resourceType: "user",
    resourceId: user.id,
  });
  return { ok: true, recoveryCodes };
}

export async function disableMfa(
  userId: string,
  password: string,
): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, organizationId: true, passwordHash: true },
  });
  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    return false;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaSecretEncrypted: null, recoveryCodesHash: Prisma.DbNull },
  });
  await recordAudit({
    organizationId: user.organizationId,
    actorId: user.id,
    action: "mfa.disabled",
    resourceType: "user",
    resourceId: user.id,
  });
  return true;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });
  const passwordOk = await verifyPassword(currentPassword, user.passwordHash);
  if (!passwordOk) {
    return false;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  return true;
}

export function hashEmail(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

const RECOVERY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRecoveryCodes(count = 10): string[] {
  function chunk(): string {
    let value = "";
    for (let c = 0; c < 4; c++) {
      value += RECOVERY_CHARS[Math.floor(Math.random() * RECOVERY_CHARS.length)] ?? "A";
    }
    return value;
  }
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(`${chunk()}-${chunk()}`);
  }
  return codes;
}

export function normalizeRecoveryCode(value: string): string {
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  }
  return compact.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

export function hashRecoveryCode(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export async function requestPasswordReset(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true },
  });
  if (!user) {
    return null;
  }
  const token = generateSecretToken();
  const expiresAt = new Date(
    Date.now() + env.PASSWORD_RESET_TTL_HOURS * 3_600_000,
  );
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: createHash("sha256").update(token).digest("hex"),
      passwordResetExpiresAt: expiresAt,
    },
  });
  return token;
}

export interface PasswordResetClaims {
  userId: string;
  organizationId: string;
}

export async function consumePasswordReset(
  token: string,
  newPassword: string,
): Promise<PasswordResetClaims | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const user = await prisma.user.findFirst({
    where: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { gt: new Date() },
    },
    select: { id: true, organizationId: true },
  });
  if (!user) {
    return null;
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    }),
    prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  return { userId: user.id, organizationId: user.organizationId };
}

function generateSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface ApiKeyInfo {
  organizationId: string;
  userId: string;
}

/**
 * Resolves an API key secret to its owner. Keys are stored as SHA-256 hashes;
 * lookups use the exact hash so the stored table never contains plaintext.
 */
export async function resolveApiKey(plaintext: string): Promise<ApiKeyInfo | null> {
  const keyHash = hashApiKey(plaintext);
  const key = await prisma.apiKey.findFirst({
    where: { keyHash, revokedAt: null },
    select: { organizationId: true, userId: true, id: true },
  });
  if (!key) {
    return null;
  }
  return { organizationId: key.organizationId, userId: key.userId };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}