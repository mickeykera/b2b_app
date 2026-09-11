import "server-only";

import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret, maskSecret, type SecretEncryptionError } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

/**
 * Organization-scoped credential repository.
 *
 * Secrets are encrypted at rest with AES-256-GCM under a tenant-derived key
 * (lib/crypto). Ciphertext never leaves the application unencrypted; plaintext
 * is only materialized transiently at execution time for the request being
 * signed.
 */

export const CREDENTIAL_PROVIDERS = [
  "generic",
  "http",
  "slack",
  "discord",
  "sendgrid",
  "hubspot",
] as const;

export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number];

export interface CreateCredentialInput {
  name: string;
  provider: CredentialProvider;
  secret: string;
  metadata?: Record<string, unknown> | null;
  createdBy?: string | null;
}

export class CredentialRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialRepositoryError";
  }
}

export async function createCredential(
  organizationId: string,
  input: CreateCredentialInput,
): Promise<{ id: string; maskedValue: string }> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new CredentialRepositoryError("Credential name is required.");
  }
  if (input.secret.length === 0) {
    throw new CredentialRepositoryError("Secret value cannot be empty.");
  }
  const ciphertext = encryptSecret(organizationId, input.secret);
  const maskedValue = maskSecret(input.secret);
  const created = await prisma.credential.create({
    data: {
      organizationId,
      name,
      provider: input.provider,
      secretCiphertext: ciphertext,
      secretIv: "",
      maskedValue,
      metadata: (input.metadata ?? null) as any,
      createdBy: input.createdBy ?? null,
    },
  });
  await recordAudit({
    organizationId,
    actorId: input.createdBy,
    action: "credential.created",
    resourceType: "credential",
    resourceId: created.id,
    metadata: { provider: input.provider, name: created.name },
  });
  return { id: created.id, maskedValue };
}

export async function listCredentials(organizationId: string) {
  const rows = await prisma.credential.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      provider: true,
      maskedValue: true,
      lastUsedAt: true,
      createdAt: true,
      createdBy: true,
    },
  });
  return rows;
}

/**
 * Decrypts a credential's secret for a one-shot use (e.g. outbound signing).
 * Strictly org-scoped — a credential from another tenant is unresolvable.
 */
export async function decryptCredential(
  organizationId: string,
  credentialId: string,
): Promise<{ id: string; provider: string; secret: string }> {
  const row = await prisma.credential.findFirst({
    where: { id: credentialId, organizationId },
    select: { id: true, provider: true, secretCiphertext: true, secretIv: true },
  });
  if (!row) {
    throw new CredentialRepositoryError(
      `Credential "${credentialId}" does not exist for this organization.`,
    );
  }
  try {
    const secret = decryptSecret(organizationId, row.secretCiphertext);
    await prisma.credential.updateMany({
      where: { id: credentialId, organizationId },
      data: { lastUsedAt: new Date() },
    });
    return { id: row.id, provider: row.provider, secret };
  } catch (cause) {
    const message = (cause as Error).message;
    throw new CredentialRepositoryError(
      `Credential "${credentialId}" could not be decrypted: ${message}`,
    );
  }
}

export async function deleteCredential(
  organizationId: string,
  credentialId: string,
  actorId?: string | null,
): Promise<void> {
  const existing = await prisma.credential.findFirst({
    where: { id: credentialId, organizationId },
    select: { id: true, name: true },
  });
  if (!existing) {
    throw new CredentialRepositoryError("Credential not found.");
  }
  await prisma.credential.delete({ where: { id: credentialId } });
  await recordAudit({
    organizationId,
    actorId,
    action: "credential.deleted",
    resourceType: "credential",
    resourceId: credentialId,
    metadata: { name: existing.name },
  });
}

export type { SecretEncryptionError };