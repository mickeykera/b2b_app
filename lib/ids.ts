import { createHash, randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/**
 * Deterministic, idempotent execution ID for a workflow run derived from the
 * tenant, workflow, and originating event. The same delivery always maps to
 * the same execution so a replayed webhook cannot produce a duplicate run.
 */
export function deriveExecutionId(
  organizationId: string,
  workflowId: string,
  eventId: string,
  occurredAtMs: number,
): string {
  const digest = createHash("sha256")
    .update([organizationId, workflowId, eventId, String(occurredAtMs)].join("\u0000"))
    .digest("base64url");
  return `run_${digest.slice(0, 20)}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 63);
}

export function newEndpointSlug(value?: string): string {
  const base = value && value.trim().length > 0 ? slugify(value) : randomUUID().slice(0, 12);
  return base;
}