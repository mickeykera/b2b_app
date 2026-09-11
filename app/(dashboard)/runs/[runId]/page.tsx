import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requirePageSession } from "@/lib/session";
import { getRun } from "@/lib/data/runs";
import { RetryRunButton } from "./retry-run-button";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  statusBadgeVariant,
} from "@/components/ui";

export const metadata = { title: "Run" };
export const dynamic = "force-dynamic";

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const session = await requirePageSession();
  const { runId } = await params;
  const run = await getRun(session.org, runId);
  if (!run) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            href="/runs"
            className="mt-1 rounded-md p-1 text-muted-foreground hover:bg-accent"
            aria-label="Back to runs"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="mono text-sm font-semibold">{run.executionId}</h2>
              <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              <Link href={`/workflows/${run.workflowId}`} className="hover:underline">
                {run.workflow?.name ?? run.workflowId}
              </Link>
              {" · "}
              {run.triggerType ?? "manual"} trigger · {formatDuration(run.durationMs)} ·{" "}
              {run.createdAt.toLocaleString()}
            </p>
          </div>
        </div>
        {run.status === "failed" && <RetryRunButton runId={run.id} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Event payload</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="mono max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">
              {JSON.stringify(run.eventPayload, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Step logs</CardTitle>
          </CardHeader>
          <CardContent>
            {run.steps.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No step logs recorded.
              </p>
            ) : (
              <ul className="space-y-2">
                {run.steps.map((step) => (
                  <li
                    key={step.id}
                    className="rounded-md border border-border bg-muted/40 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {step.label ?? step.stepKey}
                        </div>
                        <div className="mono text-[10px] uppercase tracking-wide text-muted-foreground">
                          {step.stepType} · {step.stepKey} · attempt {step.attempt}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {step.httpStatus !== null && (
                          <span className="mono text-[10px] text-muted-foreground">
                            HTTP {step.httpStatus}
                          </span>
                        )}
                        <span className="tabular text-xs text-muted-foreground">
                          {formatDuration(step.durationMs)}
                        </span>
                        <Badge variant={statusBadgeVariant(step.status)}>{step.status}</Badge>
                      </div>
                    </div>
                    {step.errorMessage ? (
                      <p className="mt-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                        {step.errorMessage}
                      </p>
                    ) : null}
                    {step.output !== null && (
                      <pre className="mono mt-2 overflow-auto rounded border border-border bg-background p-2 text-[10px]">
                        {JSON.stringify(step.output, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}