import "server-only";

import { prisma } from "@/lib/db";

/**
 * Append-only audit log.
 *
 * Writes are fire-and-forget: an audit failure is logged and must never fail
 * the primary operation. The `audit_logs` table is guarded by a database
 * trigger (see the initial migration) that blocks UPDATE and DELETE, so
 * history is tamper-evident at the storage layer.
 */

export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.password_reset_requested"
  | "auth.password_reset_completed"
  | "credential.created"
  | "credential.deleted"
  | "workflow.created"
  | "workflow.updated"
  | "workflow.deleted"
  | "workflow.activated"
  | "workflow.paused"
  | "workflow.executed"
  | "workflow.run_retried"
  | "webhook.ingested"
  | "webhook.rejected"
  | "apikey.created"
  | "apikey.revoked"
  | "run.failed"
  | "mfa.enabled"
  | "mfa.disabled"
  | "password.changed"
  | "invite.sent"
  | "invite.accepted"
  | "invite.revoked"
  | "sessions.revoked";

export interface AuditEvent {
  organizationId: string | null;
  actorId?: string | null;
  action: AuditAction | (string & {});
  resourceType?: string | null;
  resourceId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordAudit(event: AuditEvent): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: event.organizationId,
        actorId: event.actorId ?? null,
        action: event.action,
        resourceType: event.resourceType ?? null,
        resourceId: event.resourceId ?? null,
        ipAddress: event.ipAddress ?? null,
        metadata: (event.metadata ?? null) as any,
      },
    });
  } catch (cause) {
    console.error("[audit] failed to persist audit event", {
      action: event.action,
      cause,
    });
  }
}