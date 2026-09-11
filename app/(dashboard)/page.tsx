import Link from "next/link";
import { Activity, AlertTriangle, Timer, Workflow as WorkflowIcon } from "lucide-react";

import { requirePageSession } from "@/lib/session";
import { listWorkflows } from "@/lib/data/workflows";
import { getRunChartSeries, getRunMetrics, listRuns } from "@/lib/data/runs";
import { RunsChart } from "@/components/runs-chart";
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

export const metadata = { title: "Overview" };

export const dynamic = "force-dynamic";

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default async function OverviewPage() {
  const session = await requirePageSession();
  const [workflows, metrics, recent, chart] = await Promise.all([
    listWorkflows(session.org),
    getRunMetrics(session.org),
    listRuns(session.org, { pageSize: 8 }),
    getRunChartSeries(session.org),
  ]);

  const activeWorkflows = workflows.filter((w) => w.status === "active").length;

  const stats = [
    {
      label: "Workflows",
      value: String(workflows.length),
      sub: `${activeWorkflows} active`,
      icon: WorkflowIcon,
    },
    {
      label: "Runs today",
      value: String(metrics.runsToday),
      sub: `${metrics.failedLast24h} failed (24h)`,
      icon: Activity,
    },
    {
      label: "Total runs",
      value: String(metrics.totalRuns),
      sub: "all-time",
      icon: AlertTriangle,
    },
    {
      label: "Avg duration",
      value: formatDuration(metrics.avgDurationMs),
      sub: "latest run window",
      icon: Timer,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Overview</h2>
        <p className="text-sm text-muted-foreground">
          Execution health for this workspace.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-start justify-between pt-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground">
                  {stat.label}
                </div>
                <div className="mt-1 text-2xl font-semibold tabular">{stat.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{stat.sub}</div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                <stat.icon className="h-4 w-4" aria-hidden />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Run volume (14 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {chart.every((point) => point.total === 0) ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No runs in the last 14 days. Enable a workflow and send a webhook
              to see activity here.
            </p>
          ) : (
            <RunsChart points={chart} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent runs</CardTitle>
          <Link href="/api/orgs/runs/export" className="text-xs text-primary hover:underline">
            Export CSV →
          </Link>
        </CardHeader>
        <CardContent>
          {recent.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No runs yet. Enable a workflow and send a webhook to begin.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.items.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Link
                        href={`/runs/${run.id}`}
                        className="mono text-xs text-primary hover:underline"
                      >
                        {run.executionId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
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
                    <TableCell className="tabular text-sm">
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
    </div>
  );
}