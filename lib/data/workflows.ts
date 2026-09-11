import "server-only";

import { Prisma } from "@/src/generated/prisma/client";

import { prisma } from "@/lib/db";
import {
  safeParseWorkflowGraph,
  type WorkflowGraph,
  type TriggerNode,
  type ActionNode,
} from "@/lib/dag/schema";
import {
  encryptSecret,
  generateWebhookSecret,
} from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { newEndpointSlug } from "@/lib/ids";

/**
 * Organization-scoped workflow repository. Every query is filtered by
 * `organizationId` — there is no cross-tenant read path.
 */

export class WorkflowRepositoryError extends Error {
  constructor(message: string, public readonly details?: string[]) {
    super(message);
    this.name = "WorkflowRepositoryError";
  }
}

export type WorkflowStatus = "draft" | "active" | "paused";

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  version: number;
  triggerLabel: string | null;
  runs: number;
  lastRunStatus: string | null;
  updatedAt: Date;
}

async function toSummaries(
  rows: Array<{
    id: string;
    organizationId: string;
    name: string;
    description: string | null;
    status: string;
    version: number;
    triggers: Array<{ type: string; nodeKey: string }>;
    _count: { runs: number };
    updatedAt: Date;
  }>,
): Promise<WorkflowSummary[]> {
  const runs = await prisma.workflowRun.groupBy({
    by: ["workflowId"],
    where: {
      workflowId: { in: rows.map((row) => row.id) },
      organizationId: rows[0]?.organizationId ?? "none",
    },
    _max: { createdAt: true },
  });
  const latestByWorkflow = new Map<string, { createdAt: Date }>();
  for (const run of runs) {
    const existing = latestByWorkflow.get(run.workflowId);
    if (!existing || (run._max.createdAt?.getTime() ?? 0) > existing.createdAt.getTime()) {
      latestByWorkflow.set(run.workflowId, { createdAt: run._max.createdAt ?? new Date(0) });
    }
  }
  const latestRuns = await prisma.workflowRun.findMany({
    where: {
      organizationId: rows[0]?.organizationId ?? "none",
      createdAt: { in: Array.from(latestByWorkflow.values()).map((v) => v.createdAt) },
    },
    select: { workflowId: true, status: true },
  });
  const lastStatus = new Map(latestRuns.map((run) => [run.workflowId, run.status]));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: (row.status === "active" || row.status === "paused" ? row.status : "draft") as WorkflowStatus,
    version: row.version,
    triggerLabel: row.triggers[0]?.type ?? null,
    runs: row._count.runs,
    lastRunStatus: lastStatus.get(row.id) ?? null,
    updatedAt: row.updatedAt,
  }));
}

export async function listWorkflows(organizationId: string): Promise<WorkflowSummary[]> {
  const rows = await prisma.workflow.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { runs: true } },
      triggers: { select: { type: true, nodeKey: true } },
    },
  });
  return toSummaries(rows);
}

export async function getWorkflow(organizationId: string, workflowId: string) {
  return prisma.workflow.findFirst({
    where: { id: workflowId, organizationId },
    include: {
      triggers: { orderBy: { nodeKey: "asc" } },
      actions: { orderBy: { nodeKey: "asc" } },
      webhookEndpoints: true,
      _count: { select: { runs: true, deadLetters: true } },
    },
  });
}

export interface SaveWorkflowInput {
  name: string;
  description?: string | null;
  graph: WorkflowGraph;
}

export async function createWorkflow(
  organizationId: string,
  input: SaveWorkflowInput,
  actorId?: string | null,
): Promise<{ id: string }> {
  const graph = validateGraphInput(input.graph);
  const created = await prisma.workflow.create({
    data: {
      organizationId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: "draft",
      graph: graph as object,
      createdBy: actorId ?? null,
    },
  });
  await syncGraphProjection(organizationId, created.id, graph);
  await recordAudit({
    organizationId,
    actorId,
    action: "workflow.created",
    resourceType: "workflow",
    resourceId: created.id,
    metadata: { name: created.name },
  });
  return { id: created.id };
}

export async function updateWorkflow(
  organizationId: string,
  workflowId: string,
  input: SaveWorkflowInput & { bumpVersion?: boolean },
  actorId?: string | null,
): Promise<{ id: string }> {
  const existing = await prisma.workflow.findFirst({
    where: { id: workflowId, organizationId },
    select: { id: true, graph: true },
  });
  if (!existing) {
    throw new WorkflowRepositoryError("Workflow not found.");
  }

  const graph = validateGraphInput(input.graph);
  const graphChanged = JSON.stringify(existing.graph) !== JSON.stringify(graph);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.workflow.update({
      where: { id: workflowId },
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        graph: graph as object,
        ...(graphChanged || input.bumpVersion ? { version: { increment: 1 } } : {}),
      },
    });
    await syncGraphProjection(organizationId, workflowId, graph, tx);
    return row;
  });

  await recordAudit({
    organizationId,
    actorId,
    action: "workflow.updated",
    resourceType: "workflow",
    resourceId: workflowId,
    metadata: { version: updated.version },
  });
  return { id: workflowId };
}

export async function deleteWorkflow(
  organizationId: string,
  workflowId: string,
  actorId?: string | null,
): Promise<void> {
  const existing = await prisma.workflow.findFirst({
    where: { id: workflowId, organizationId },
    select: { id: true },
  });
  if (!existing) {
    throw new WorkflowRepositoryError("Workflow not found.");
  }
  await prisma.workflow.delete({ where: { id: workflowId } });
  await recordAudit({
    organizationId,
    actorId,
    action: "workflow.deleted",
    resourceType: "workflow",
    resourceId: workflowId,
  });
}

export async function setWorkflowStatus(
  organizationId: string,
  workflowId: string,
  status: WorkflowStatus,
  actorId?: string | null,
): Promise<void> {
  const existing = await prisma.workflow.findFirst({
    where: { id: workflowId, organizationId },
    select: { id: true, graph: true },
  });
  if (!existing) {
    throw new WorkflowRepositoryError("Workflow not found.");
  }
  if (status === "active") {
    validateGraphInput(existing.graph as WorkflowGraph);
  }
  await prisma.workflow.update({
    where: { id: workflowId },
    data: { status },
  });
  await recordAudit({
    organizationId,
    actorId,
    action: status === "active" ? "workflow.activated" : "workflow.paused",
    resourceType: "workflow",
    resourceId: workflowId,
  });
}

function validateGraphInput(input: unknown): WorkflowGraph {
  const verdict = safeParseWorkflowGraph(input);
  if (!verdict.ok) {
    throw new WorkflowRepositoryError("Workflow graph is invalid.", verdict.errors);
  }
  return verdict.graph;
}

type Tx = Prisma.TransactionClient;

/**
 * Projects the workflow DAG into relational `Trigger`/`Action` rows and
 * upserts webhook endpoints (generating encrypted HMAC secrets once per
 * endpoint; subsequent saves keep the same secret so URLs remain valid).
 */
async function syncGraphProjection(
  organizationId: string,
  workflowId: string,
  graph: WorkflowGraph,
  tx?: Tx,
): Promise<void> {
  const db = tx ?? prisma;
  const triggers: TriggerNode[] = [];
  const actions: ActionNode[] = [];
  for (const node of graph.nodes) {
    if (node.type === "trigger") {
      triggers.push(node);
    } else if (node.type === "action") {
      actions.push(node);
    }
  }

  await db.trigger.deleteMany({ where: { workflowId } });
  if (triggers.length > 0) {
    await db.trigger.createMany({
      data: triggers.map((node) => ({
        organizationId,
        workflowId,
        nodeKey: node.key,
        type: node.config.subtype,
        config: node.config as unknown as Prisma.InputJsonValue,
      })),
    });
  }

  await db.action.deleteMany({ where: { workflowId } });
  if (actions.length > 0) {
    await db.action.createMany({
      data: actions.map((node) => ({
        organizationId,
        workflowId,
        nodeKey: node.key,
        type: node.config.subtype,
        config: node.config as unknown as Prisma.InputJsonValue,
      })),
    });
  }

  const existingEndpoints = await db.webhookEndpoint.findMany({
    where: { workflowId, organizationId },
    select: { triggerKey: true, hmacSecretCiphertext: true, hmacSecretIv: true, slug: true, id: true },
  });
  const secretByTriggerKey = new Map(
    existingEndpoints.map((endpoint) => [endpoint.triggerKey, endpoint]),
  );

  const newSecrets = new Map<string, { ciphertext: string; iv: string }>();
  const endpointRows: Array<{
    organizationId: string;
    workflowId: string;
    triggerKey: string;
    slug: string;
    hmacSecretCiphertext: string;
    hmacSecretIv: string;
    enabled: boolean;
  }> = [];

  for (const node of triggers) {
    if (node.config.subtype !== "webhook" || node.type !== "trigger") {
      continue;
    }
    const webhookConfig = node.config;
    const existing = secretByTriggerKey.get(node.key);
    if (existing) {
      newSecrets.set(node.key, {
        ciphertext: existing.hmacSecretCiphertext,
        iv: existing.hmacSecretIv,
      });
    } else {
      const secret = generateWebhookSecret();
      newSecrets.set(node.key, {
        ciphertext: encryptSecret(organizationId, secret),
        iv: "",
      });
    }
    const secret = newSecrets.get(node.key)!;
    endpointRows.push({
      organizationId,
      workflowId,
      triggerKey: node.key,
      slug: slugFor(webhookConfig.endpointSlug),
      hmacSecretCiphertext: secret.ciphertext,
      hmacSecretIv: secret.iv,
      enabled: true,
    });
  }

  await db.webhookEndpoint.deleteMany({ where: { workflowId, organizationId } });
  if (endpointRows.length > 0) {
    await db.webhookEndpoint.createMany({ data: endpointRows });
  }
}

function slugFor(endpointSlug: string): string {
  return newEndpointSlug(endpointSlug);
}

/** Resolves the eligible organization for a webhook ingress path. */
export async function resolveOrganizationBySlug(slug: string) {
  return prisma.organization.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
}