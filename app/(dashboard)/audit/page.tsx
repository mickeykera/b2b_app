import { requirePageSession } from "@/lib/session";
import { auditLogPage } from "@/lib/data/audit";
import {
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
} from "@/components/ui";

export const metadata = { title: "Audit" };
export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePageSession();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const result = await auditLogPage(session.org, { page, pageSize: 50 });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Audit log</h2>
        <p className="text-sm text-muted-foreground">
          Append-only, tamper-evident event history for this organization.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Events ({result.total})</CardTitle>
          <span className="text-xs text-muted-foreground">Page {result.page}</span>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No audit events yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {event.createdAt.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <span className="mono text-xs">{event.action}</span>
                    </TableCell>
                    <TableCell className="mono text-xs text-muted-foreground">
                      {event.resourceType ?? "—"}
                      {event.resourceId ? `:${event.resourceId}` : ""}
                    </TableCell>
                    <TableCell className="mono text-xs text-muted-foreground">
                      {event.actorId ?? "—"}
                    </TableCell>
                    <TableCell className="mono text-xs text-muted-foreground">
                      {event.ipAddress ?? "—"}
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