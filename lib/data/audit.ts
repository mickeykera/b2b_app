import "server-only";

import { prisma } from "@/lib/db";
import { type AuditAction, recordAudit } from "@/lib/audit";

export type { AuditAction };

export async function listAuditLogs(
  organizationId: string,
  options: { actorId?: string; action?: string; limit?: number; offset?: number } = {},
) {
  return prisma.auditLog.findMany({
    where: {
      organizationId,
      ...(options.actorId ? { actorId: options.actorId } : {}),
      ...(options.action ? { action: options.action } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, options.limit ?? 50),
    skip: options.offset ?? 0,
  });
}

export async function auditLogPage(
  organizationId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where: { organizationId } }),
  ]);
  return { items: rows, total, page, pageSize };
}

/** Append-only entry point used by callers that already built audit payloads. */
export async function pushAuditLog(
  organizationId: string,
  input: Parameters<typeof recordAudit>[0] & { actorId?: string | null },
): Promise<void> {
  await recordAudit({ ...input, organizationId });
}