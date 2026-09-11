import { requirePageSession } from "@/lib/session";
import { listCredentials } from "@/lib/data/credentials";
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
import { NewCredentialForm } from "./new-credential-form";
import { DeleteCredentialButton } from "./delete-credential-button";

export const metadata = { title: "Credentials" };
export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  const session = await requirePageSession();
  const credentials = await listCredentials(session.org);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Credentials</h2>
          <p className="text-sm text-muted-foreground">
            Secrets for outbound actions. Encrypted at rest under your
            tenant-derived key; masked everywhere in the UI.
          </p>
        </div>
        <NewCredentialForm />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connectors</CardTitle>
        </CardHeader>
        <CardContent>
          {credentials.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No credentials yet. Add one to enable Slack, Discord, SendGrid,
              HubSpot, or generic HTTP actions.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="text-right">Last used</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((credential) => (
                  <TableRow key={credential.id}>
                    <TableCell className="font-medium">{credential.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {credential.provider}
                    </TableCell>
                    <TableCell className="mono text-xs text-muted-foreground">
                      {credential.maskedValue}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {credential.lastUsedAt ? credential.lastUsedAt.toLocaleString() : "never"}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {credential.createdAt.toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteCredentialButton credentialId={credential.id} />
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