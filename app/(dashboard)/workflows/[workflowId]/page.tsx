import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/db";
import { requirePageSession } from "@/lib/session";
import { env } from "@/lib/env";
import { getWorkflow } from "@/lib/data/workflows";
import { listRuns } from "@/lib/data/runs";
import { WebhookUrl } from "./webhook-url";
import { SendTestWebhook } from "./send-test-webhook";
import { WorkflowActions } from "./workflow-actions";
import { GraphViewer } from "./graph-viewer";
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

export const metadata = { title: "Workflow" };
export const dynamic = "force-dynamic";

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const session = await requirePageSession();
  const { workflowId } = await params;
  const workflow = await getWorkflow(session.org, workflowId);
  if (!workflow) {
    notFound();
  }

  const org = await prisma.organization.findUnique({
    where: { id: session.org },
    select: { slug: true },
  });

  const recentRuns = await listRuns(session.org, { pageSize: 10 });

  const webhookEndpoint = workflow.webhookEndpoints.find((endpoint) => endpoint.enabled);
  const webhookUrl = webhookEndpoint
    ? `${env.APP_BASE_URL}/api/webhooks/${org?.slug ?? "org"}/${webhookEndpoint.slug}`
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            href="/workflows"
            className="mt-1 rounded-md p-1 text-muted-foreground hover:bg-accent"
            aria-label="Back to workflows"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{workflow.name}</h2>
              <Badge variant={statusBadgeVariant(workflow.status)}>{workflow.status}</Badge>
              <span className="text-xs text-muted-foreground">v{workflow.version}</span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {workflow.description ?? "No description."}
            </p>
          </div>
        </div>
        <WorkflowActions workflowId={workflow.id} status={workflow.status} />
      </div>

      {webhookUrl && (
        <Card>
          <CardHeader>
            <CardTitle>Webhook endpoint</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <code className="mono flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 text-xs">
              {webhookUrl}
            </code>
            <WebhookUrl url={webhookUrl} />
          </CardContent>
          <CardContent className="flex flex-col gap-2">
            <SendTestWebhook workflowId={workflow.id} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <GraphViewer graph={workflow.graph as never} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent runs</CardTitle>
            <Link href="/runs" className="text-xs text-primary hover:underline">
              View all →
            </Link>
          </CardHeader>
          <CardContent>
            {recentRuns.items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No runs recorded yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="text-right">Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRuns.items.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link
                          href={`/runs/${run.id}`}
                          className="inline-flex hover:underline"
                        >
                          <Badge variant={statusBadgeVariant(run.status)}>
                            {run.status}
                          </Badge>
                        </Link>
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Raw graph</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="mono max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">
            {JSON.stringify(workflow.graph, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}