import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { hashPassword } from "@/lib/passwords";
import { newId } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";

/**
 * Org-scoped member invitations.
 *
 * Tokens are random high-entropy secrets; only their SHA-256 hash is stored.
 * An invitation is single-use and can be revoked by the issuing admin before
 * acceptance.
 */

export interface InvitationInfo {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  expiresAt: Date;
}

export async function createInvitation(input: {
  organizationId: string;
  invitedById: string;
  email: string;
  role?: string;
  ttlDays?: number;
}): Promise<{ token: string; invitation: InvitationInfo }> {
  const ttlDays = input.ttlDays ?? env.INVITE_TTL_DAYS;
  const token = randomBytes(32).toString("base64url");
  const invitationId = newId("inv_");
  const invitation = await prisma.invitation.create({
    data: {
      id: invitationId,
      organizationId: input.organizationId,
      email: input.email.trim().toLowerCase(),
      role: input.role ?? "member",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      invitedById: input.invitedById,
      expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
    },
  });
  await recordAudit({
    organizationId: input.organizationId,
    actorId: input.invitedById,
    action: "invite.sent",
    resourceType: "invitation",
    resourceId: invitation.id,
    metadata: { email: invitation.email, role: invitation.role },
  });
  return {
    token,
    invitation: {
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    },
  };
}

export async function resolveInvitation(token: string): Promise<InvitationInfo | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      email: true,
      role: true,
      expiresAt: true,
      revokedAt: true,
      acceptedAt: true,
    },
  });
  if (!invitation) {
    return null;
  }
  const now = new Date();
  if (invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= now) {
    return null;
  }
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
  };
}

/** Accepts an invitation by creating the member account in the inviting org. */
export async function acceptInvitation(input: {
  token: string;
  name: string;
  password: string;
}): Promise<{ userId: string; organizationId: string; email: string } | null> {
  const invitation = await resolveInvitation(input.token);
  if (!invitation) {
    return null;
  }
  const existing = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });
  if (existing) {
    return null;
  }
  const userId = newId("usr_");
  const passwordHash = await hashPassword(input.password);
  const invitationId = invitation.id;
  await prisma.$transaction([
    prisma.user.create({
      data: {
        id: userId,
        organizationId: invitation.organizationId,
        email: invitation.email,
        name: input.name.trim(),
        passwordHash,
        role: invitation.role,
      },
    }),
    prisma.invitation.update({
      where: { id: invitationId },
      data: { acceptedAt: new Date(), acceptedByUserId: userId },
    }),
  ]);
  await recordAudit({
    organizationId: invitation.organizationId,
    actorId: userId,
    action: "invite.accepted",
    resourceType: "invitation",
    resourceId: invitationId,
    metadata: { email: invitation.email },
  });
  return {
    userId,
    organizationId: invitation.organizationId,
    email: invitation.email,
  };
}

export async function revokeInvitation(
  organizationId: string,
  invitationId: string,
  revokedById: string,
): Promise<boolean> {
  const result = await prisma.invitation.updateMany({
    where: { id: invitationId, organizationId, revokedAt: null, acceptedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 1) {
    await recordAudit({
      organizationId,
      actorId: revokedById,
      action: "invite.revoked",
      resourceType: "invitation",
      resourceId: invitationId,
    });
    return true;
  }
  return false;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export async function listInvitations(
  organizationId: string,
): Promise<InvitationRow[]> {
  return prisma.invitation.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
    },
  });
}