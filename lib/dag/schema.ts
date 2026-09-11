import { z } from "zod";

/**
 * Workflow definition schema.
 *
 * A workflow is a directed acyclic graph (DAG) of nodes:
 *
 *   Trigger -> [Filter ...] -> [Transform ...] -> [Action ...]
 *
 * Every node has a unique `key`, a `type` and a per-type `config`. Actions and
 * triggers carry a `subtype` discriminator. All payloads are validated with
 * zod on write (editor/API) and read (execution), so a malformed graph can
 * never reach the runner.
 */

const nodeKey = z.string().trim().min(1).max(64);

// --- Triggers --------------------------------------------------------------

export const webhookTriggerSchema = z.object({
  subtype: z.literal("webhook"),
  endpointSlug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{2,63}$/, "Endpoint slug must be 3-64 chars of lowercase letters, digits, and dashes."),
});

export const scheduleTriggerSchema = z.object({
  subtype: z.literal("schedule"),
  cron: z
    .string()
    .trim()
    .regex(/^(@(hourly|daily|weekly|monthly|yearly|annually))$|^(\S+\s\S+\s\S+\s\S+\s\S+)$/, "cron must be a 5-field expression (e.g. 0 9 * * 1)."),
  timezone: z.string().trim().min(1).default("Etc/UTC"),
});

export const appEventTriggerSchema = z.object({
  subtype: z.literal("app_event"),
  eventName: z.string().trim().min(1).max(128),
});

export const triggerConfigSchema = z.discriminatedUnion("subtype", [
  webhookTriggerSchema,
  scheduleTriggerSchema,
  appEventTriggerSchema,
]);

export const triggerNodeSchema = z.object({
  type: z.literal("trigger"),
  key: nodeKey,
  label: z.string().trim().max(80).optional(),
  config: triggerConfigSchema,
});

// --- Filters ----------------------------------------------------------------

export const FILTER_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not_exists",
  "contains",
  "starts_with",
  "ends_with",
  "regex",
] as const;

export const filterOperatorSchema = z.enum(FILTER_OPERATORS);

export const filterConditionSchema = z.object({
  path: z.string().trim().min(1, "Condition path is required (e.g. $.payload.status)"),
  operator: filterOperatorSchema,
  value: z.unknown().optional(),
});

export const filterConfigSchema = z
  .object({
    mode: z.enum(["all", "any"]).default("all"),
    conditions: z.array(filterConditionSchema).min(1, "A filter needs at least one condition."),
  })
  .strict();

export const filterNodeSchema = z.object({
  type: z.literal("filter"),
  key: nodeKey,
  label: z.string().trim().max(80).optional(),
  config: filterConfigSchema,
});

// --- Transforms -------------------------------------------------------------

export const transformMappingSchema = z.object({
  from: z.string().trim().min(1, "From path is required (e.g. $.payload.order.id)"),
  to: z.string().trim().min(1, "To path is required (e.g. orderId)"),
});

export const transformConfigSchema = z
  .object({
    mappings: z.array(transformMappingSchema).min(1, "A transform needs at least one mapping."),
  })
  .strict();

export const transformNodeSchema = z.object({
  type: z.literal("transform"),
  key: nodeKey,
  label: z.string().trim().max(80).optional(),
  config: transformConfigSchema,
});

// --- Actions ----------------------------------------------------------------

const authConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("none"),
  }),
  z.object({
    type: z.literal("bearer"),
    tokenTemplate: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("bearer_credential"),
    credentialId: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("basic"),
    usernameTemplate: z.string().trim().min(1),
    passwordTemplate: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("api_key"),
    name: z.string().trim().min(1),
    valueTemplate: z.string().trim().min(1),
  }),
]);

export const httpHeaderSchema = z.object({
  name: z.string().trim().min(1),
  value: z.string(), // may contain {{ path }} interpolation
});

export const httpActionSchema = z.object({
  subtype: z.literal("http"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().trim().min(1, "URL is required."),
  headers: z.array(httpHeaderSchema).default([]),
  auth: authConfigSchema.default({ type: "none" }),
  payload: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.coerce.number().int().min(500).max(60_000).default(10_000),
});

export const slackActionSchema = z.object({
  subtype: z.literal("slack"),
  credentialId: z.string().trim().min(1, "A Slack webhook credential is required."),
  text: z.string().trim().min(1, "Message text is required."),
  channel: z.string().trim().optional(),
});

export const discordActionSchema = z.object({
  subtype: z.literal("discord"),
  credentialId: z.string().trim().min(1, "A Discord webhook credential is required."),
  content: z.string().trim().min(1, "Message content is required."),
  username: z.string().trim().optional(),
});

export const sendgridActionSchema = z.object({
  subtype: z.literal("sendgrid"),
  credentialId: z.string().trim().min(1, "A SendGrid API key credential is required."),
  from: z.string().trim().min(3),
  to: z.array(z.string().trim().min(3)).min(1),
  subject: z.string().trim().min(1),
  textTemplate: z.string().trim().min(1),
  htmlTemplate: z.string().trim().optional(),
});

export const hubspotActionSchema = z.object({
  subtype: z.literal("hubspot"),
  credentialId: z.string().trim().min(1, "A HubSpot API key credential is required."),
  objectType: z.string().trim().min(1).default("contacts"),
  properties: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        valueTemplate: z.string().trim().min(1),
      }),
    )
    .min(1),
});

export const actionConfigSchema = z.discriminatedUnion("subtype", [
  httpActionSchema,
  slackActionSchema,
  discordActionSchema,
  sendgridActionSchema,
  hubspotActionSchema,
]);

export const actionNodeSchema = z.object({
  type: z.literal("action"),
  key: nodeKey,
  label: z.string().trim().max(80).optional(),
  config: actionConfigSchema,
});

// --- Graph ------------------------------------------------------------------

export const workflowNodeSchema = z.discriminatedUnion("type", [
  triggerNodeSchema,
  filterNodeSchema,
  transformNodeSchema,
  actionNodeSchema,
]);

export const workflowEdgeSchema = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
});

export function validateGraph(graph: {
  nodes: z.infer<typeof workflowNodeSchema>[];
  edges: z.infer<typeof workflowEdgeSchema>[];
}): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  if (graph.nodes.length === 0) {
    errors.push("A workflow must contain at least one node.");
  }
  const keys = new Set(graph.nodes.map((n) => n.key));
  const triggers = graph.nodes.filter((n) => n.type === "trigger");

  if (triggers.length !== 1) {
    errors.push(`A workflow must have exactly one trigger; found ${triggers.length}.`);
  }

  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of graph.nodes) {
    adjacency.set(node.key, []);
    indegree.set(node.key, 0);
  }
  const seenEdges = new Set<string>();
  for (const edge of graph.edges) {
    if (!keys.has(edge.from) || !keys.has(edge.to)) {
      errors.push(`Edge "${edge.from} -> ${edge.to}" references an unknown node.`);
      continue;
    }
    if (edge.from === edge.to) {
      errors.push(`Edge "${edge.from} -> ${edge.to}" is a self-loop.`);
      continue;
    }
    const pair = `${edge.from}\u0000${edge.to}`;
    if (seenEdges.has(pair)) {
      errors.push(`Duplicate edge "${edge.from} -> ${edge.to}".`);
      continue;
    }
    seenEdges.add(pair);
    adjacency.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  // Cycle detection (Kahn's algorithm).
  const queue = graph.nodes.filter((n) => (indegree.get(n.key) ?? 0) === 0).map((n) => n.key);
  const visited: string[] = [];
  while (queue.length > 0) {
    const key = queue.shift()!;
    visited.push(key);
    for (const next of adjacency.get(key) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }
  if (visited.length !== graph.nodes.length) {
    const leftover = graph.nodes.filter((n) => !visited.includes(n.key)).map((n) => n.key);
    errors.push(`Graph contains a cycle involving: ${leftover.join(", ")}.`);
  }

  // Reachability: every node must be reachable from the trigger.
  const triggerKey = triggers[0]?.key;
  if (triggerKey) {
    const reachable = new Set<string>();
    const stack = [triggerKey];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (reachable.has(current)) {
        continue;
      }
      reachable.add(current);
      for (const next of adjacency.get(current) ?? []) {
        stack.push(next);
      }
    }
    for (const node of graph.nodes) {
      if (!reachable.has(node.key)) {
        errors.push(`Node "${node.key}" is not reachable from the trigger.`);
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export const workflowGraphSchema = z
  .object({
    nodes: z.array(workflowNodeSchema).min(1, "At least one node is required."),
    edges: z.array(workflowEdgeSchema).default([]),
  })
  .superRefine((graph, ctx) => {
    const verdict = validateGraph(graph);
    if (!verdict.valid) {
      for (const error of verdict.errors) {
        ctx.addIssue({ code: "custom", message: error });
      }
    }
  });

export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type TriggerNode = WorkflowNode & { type: "trigger" };
export type FilterNode = WorkflowNode & { type: "filter" };
export type TransformNode = WorkflowNode & { type: "transform" };
export type ActionNode = WorkflowNode & { type: "action" };

export type TriggerConfig = z.infer<typeof triggerConfigSchema>;
export type FilterConfig = z.infer<typeof filterConfigSchema>;
export type TransformConfig = z.infer<typeof transformConfigSchema>;
export type ActionConfig = z.infer<typeof actionConfigSchema>;

export function parseWorkflowGraph(input: unknown): WorkflowGraph {
  return workflowGraphSchema.parse(input);
}

/** Safe wrapper returning a human-readable error list instead of throwing. */
export function safeParseWorkflowGraph(
  input: unknown,
): { ok: true; graph: WorkflowGraph } | { ok: false; errors: string[] } {
  const result = workflowGraphSchema.safeParse(input);
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map((issue) => issue.message) };
  }
  return { ok: true, graph: result.data };
}

/**
 * Topological order (when the graph is validated). Used by the runner and the
 * editor's pipeline renderer.
 */
export function topoSort(graph: WorkflowGraph): WorkflowNode[] {
  const verdict = validateGraph(graph);
  if (!verdict.valid) {
    throw new Error(`Cannot topologically sort an invalid graph: ${verdict.errors.join("; ")}`);
  }
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of graph.nodes) {
    adjacency.set(node.key, []);
    indegree.set(node.key, 0);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to)! + 1);
  }
  const queue = graph.nodes.filter((n) => indegree.get(n.key) === 0).map((n) => n.key);
  const sorted: WorkflowNode[] = [];
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));
  while (queue.length > 0) {
    const key = queue.shift()!;
    sorted.push(byKey.get(key)!);
    for (const next of adjacency.get(key) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) {
        queue.push(next);
      }
    }
  }
  return sorted;
}