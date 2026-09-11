import "server-only";

import { prisma } from "@/lib/db";
import {
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
} from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { parseWorkflowGraph, type WorkflowGraph } from "@/lib/dag/schema";
import { newId } from "@/lib/ids";

/**
 * Webhook endpoint resolution + secret handling. Everything is org-scoped:
 * a caller must always present both the organization slug and a workflow's
 * endpoint slug, and endpoints are looked up under that organization.
 */

export interface ResolvedEndpoint {
  organizationId: string;
  organizationSlug: string;
  workflowId: string;
  workflowName: string;
  workflowStatus: string;
  triggerConfig: string[] | null;
  secret: string;
  graph: WorkflowGraph;
}

export async function resolveWebhookEndpoint(
  organizationId: string,
  workflowId: string | null,
  endpointSlug: string,
): Promise<ResolvedEndpoint | null> {
  const where = {
    slug: endpointSlug,
    enabled: true,
    organizationId,
    ...(workflowId ? { workflowId } : {}),
  };
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where,
    include: {
      workflow: { select: { id: true, name: true, status: true, graph: true } },
      organization: { select: { slug: true } },
    },
  });
  if (!endpoint?.workflow) {
    return null;
  }
  return {
    organizationId,
    organizationSlug: endpoint.organization.slug,
    workflowId: endpoint.workflow.id,
    workflowName: endpoint.workflow.name,
    workflowStatus: endpoint.workflow.status,
    triggerConfig: null,
    secret: decryptSecret(organizationId, endpoint.hmacSecretCiphertext),
    graph: parseWorkflowGraph(endpoint.workflow.graph as unknown),
  };
}

export async function getEndpointBySlug(organizationId: string, slug: string) {
  return prisma.webhookEndpoint.findFirst({
    where: { slug, organizationId },
    include: { workflow: { select: { id: true, name: true, status: true } } },
  });
}

export async function generateEndpointSecret(organizationId: string, endpointId: string) {
  const secret = generateWebhookSecret();
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, organizationId },
    select: { id: true },
  });
  if (!endpoint) {
    return null;
  }
  await prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: { hmacSecretCiphertext: encryptSecret(organizationId, secret), hmacSecretIv: "" },
  });
  return secret;
}

/** Counts triggered events for a workflow within the last N minutes (display). */
export async function countRecentIngestions(organizationId: string, workflowId?: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.workflowRun.groupBy({
    by: ["triggerType"],
    where: {
      organizationId,
      ...(workflowId ? { workflowId } : {}),
      createdAt: { gte: since },
    },
    _count: { id: true },
  });
  return rows.map((row) => ({
    triggerType: row.triggerType,
    count: row._count.id,
  }));
}

/** Creates an api key row-backed endpoint token if the schema ever grows. */
export async function createEndpointId(organizationId: string): Promise<string> {
  void organizationId;
  return newId("ep_");
}

export async function logIngestEvent(
  organizationId: string,
  event: {
    workflowId: string;
    accepted: boolean;
    reason?: string;
    actorIp?: string | null;
  },
): Promise<void> {
  await recordAudit({
    organizationId,
    action: event.accepted ? "webhook.ingested" : "webhook.rejected",
    resourceType: "workflow",
    resourceId: event.workflowId,
    ipAddress: event.actorIp ?? null,
    metadata: event.reason
      ? { reason: event.reason }
      : undefined,
  });
}