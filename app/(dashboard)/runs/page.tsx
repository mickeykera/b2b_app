import Link from "next/link";

import { requirePageSession } from "@/lib/session";
import { listRuns } from "@/lib/data/runs";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  statusBadgeVariant,
} from "@/components/ui";

export const metadata = { title: "Runs" };
export const dynamic = "force-dynamic";

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const session = await requirePageSession();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const result = await listRuns(session.org, { page, pageSize: 25, status: params.status });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Runs</h2>
        <p className="text-sm text-muted-foreground">
          Every workflow execution, with step-level logs available on each run.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>All runs ({result.total})</CardTitle>
          <div className="flex items-center gap-3">
            <Link
              href={`/api/orgs/runs/export?status=${encodeURIComponent(params.status ?? "")}`}
              className="text-xs text-primary hover:underline"
            >
              Export CSV
            </Link>
            <span className="text-xs text-muted-foreground">
              Page {result.page}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No runs yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Execution</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Link
                        href={`/runs/${run.id}`}
                        className="mono text-xs text-primary hover:underline"
                      >
                        {run.executionId}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/workflows/${run.workflowId}`}
                        className="hover:underline"
                      >
                        {run.workflowName ?? run.workflowId}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {run.triggerType ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular text-sm">
                      {formatDuration(run.durationMs)}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {run.createdAt.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {result.total > result.pageSize && (
        <div className="flex justify-end gap-2">
          {result.page > 1 && (
            <Link
              href={`/runs?page=${result.page - 1}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Previous
            </Link>
          )}
          {result.page * result.pageSize < result.total && (
            <Link
              href={`/runs?page=${result.page + 1}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}