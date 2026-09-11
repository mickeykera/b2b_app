import { Filter, GitBranch, Settings2, Workflow, Zap } from "lucide-react";

import { WorkflowGraph } from "@/lib/dag/schema";

function iconFor(type: string) {
  switch (type) {
    case "trigger":
      return Workflow;
    case "filter":
      return Filter;
    case "transform":
      return Settings2;
    case "action":
      return Zap;
    default:
      return GitBranch;
  }
}

export function GraphViewer({ graph }: { graph: WorkflowGraph }) {
  const nodes = (graph?.nodes ?? []) as Array<{
    key: string;
    type: string;
    label?: string;
    config?: Record<string, unknown>;
  }>;
  const edges = (graph?.edges ?? []) as Array<{ from: string; to: string }>;

  return (
    <div className="space-y-3">
      {nodes.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          This workflow has no nodes yet.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {nodes.map((node, index) => {
            const Icon = iconFor(node.type);
            const subtype = typeof node.config?.subtype === "string" ? node.config.subtype : null;
            return (
              <li key={node.key} className="flex items-center gap-2">
                {index < nodes.length - 1 ? (
                  <div className="flex flex-col items-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground">
                      <Icon className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="h-2 w-px bg-border" />
                  </div>
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground">
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {node.label ?? node.key}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {node.type}
                    {subtype ? ` · ${subtype}` : ""}
                  </div>
                </div>
                <span className="ml-auto mono text-[10px] text-muted-foreground">
                  {node.key}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {edges.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Edges
          </div>
          <div className="flex flex-wrap gap-1">
            {edges.map((edge) => (
              <span
                key={`${edge.from}:${edge.to}`}
                className="mono rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {edge.from} → {edge.to}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}