import { requirePageSession } from "@/lib/session";
import { listUserSessions } from "@/lib/data/sessions";
import { listInvitations } from "@/lib/data/invitations";
import { prisma } from "@/lib/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { PasswordForm } from "./password-form";
import { MfaSection } from "./mfa-section";
import { SessionsList } from "./sessions-list";
import { InvitesSection } from "./invites-section";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requirePageSession();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.sub },
    select: { name: true, email: true, mfaEnabled: true },
  });
  const sessions = (await listUserSessions(session.sub)).map((row) => ({
    id: row.id,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    current: session.jti != null && row.id === session.jti,
  }));
  const isAdmin = session.role === "admin";
  const invites = isAdmin ? await listInvitations(session.org) : [];
  const members = isAdmin
    ? await prisma.user.findMany({
        where: { organizationId: session.org },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Password, two-factor authentication, active sessions, and team access.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>
              Signed in as {user.email}. Changing it ends every other session.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Two-factor authentication</CardTitle>
            <CardDescription>
              TOTP codes from your authenticator app plus backup codes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MfaSection enabled={user.mfaEnabled} email={user.email} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>
              Devices currently signed in to this account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SessionsList initialSessions={sessions} currentId={session.jti} />
          </CardContent>
        </Card>

        {isAdmin && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Team</CardTitle>
              <CardDescription>
                Invite teammates to join this workspace. Invitations expire
                after 7 days.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InvitesSection initialInvites={invites} members={members} currentUserId={session.sub} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}