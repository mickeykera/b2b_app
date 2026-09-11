import Link from "next/link";

import { requirePageSession } from "@/lib/session";
import { listWorkflows } from "@/lib/data/workflows";
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
import { CreateWorkflowForm } from "./create-workflow-form";

export const metadata = { title: "Workflows" };
export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const session = await requirePageSession();
  const workflows = await listWorkflows(session.org);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Workflows</h2>
          <p className="text-sm text-muted-foreground">
            Trigger→filter→action pipelines. Activation publishes webhook
            endpoints and cron schedules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CreateWorkflowForm />
          <Link
            href="/workflows/new"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Guided builder
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All workflows</CardTitle>
        </CardHeader>
        <CardContent>
          {workflows.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No workflows yet.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Version</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.map((workflow) => (
                  <TableRow key={workflow.id}>
                    <TableCell>
                      <Link
                        href={`/workflows/${workflow.id}`}
                        className="font-medium hover:underline"
                      >
                        {workflow.name}
                      </Link>
                      {workflow.description ? (
                        <div className="max-w-md truncate text-xs text-muted-foreground">
                          {workflow.description}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {workflow.triggerLabel ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(workflow.status)}>
                        {workflow.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular text-sm">
                      {workflow.runs}
                    </TableCell>
                    <TableCell className="text-right tabular text-sm">
                      v{workflow.version}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {workflow.updatedAt.toLocaleDateString()}
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