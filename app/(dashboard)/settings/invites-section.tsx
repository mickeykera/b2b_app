"use client";

import { useState } from "react";
import { Loader2, MailPlus, UserPlus } from "lucide-react";

import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";

export interface InvitationRow {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export interface MemberRow {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: Date;
}

interface InvitesSectionProps {
  initialInvites: InvitationRow[];
  members: MemberRow[];
  currentUserId: string;
}

export function InvitesSection({ initialInvites, members, currentUserId }: InvitesSectionProps) {
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [busyRevoke, setBusyRevoke] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function addInvite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/orgs/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        invitation?: InvitationRow;
        error?: string;
      };
      if (!response.ok || !body.invitation) {
        setError(body.error ?? "Could not send invitation.");
        return;
      }
      setInvites([body.invitation, ...invites]);
      setEmail("");
      setSuccess(`Invitation sent to ${body.invitation.email}.`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitationId: string) {
    setBusyRevoke(invitationId);
    setError(null);
    try {
      const response = await fetch(`/api/orgs/invitations/${encodeURIComponent(invitationId)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError("Could not revoke the invitation.");
        return;
      }
      setInvites(invites.map((inv) => (inv.id === invitationId ? { ...inv, revokedAt: new Date() } : inv)));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusyRevoke(null);
    }
  }

  const pending = invites.filter((inv) => !inv.acceptedAt && !inv.revokedAt);

  return (
    <div className="space-y-6">
      <form onSubmit={addInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="inviteEmail">Email</Label>
          <Input
            id="inviteEmail"
            type="email"
            required
            placeholder="teammate@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="w-full space-y-1.5 sm:w-32">
          <Label htmlFor="inviteRole">Role</Label>
          <Select id="inviteRole" value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </div>
        <Button type="submit" disabled={busy} className="shrink-0">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
          Send invite
        </Button>
      </form>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          {success}
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Pending invitations</p>
          <ul className="divide-y divide-border">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{inv.email}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {inv.role} · expires {inv.expiresAt.toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyRevoke === inv.id}
                  onClick={() => revoke(inv.id)}
                  className="shrink-0"
                >
                  {busyRevoke === inv.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Revoke"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Members</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="font-medium">
                  {member.name ?? "—"}
                  {member.id === currentUserId && <span className="ml-2 text-[10px] text-muted-foreground">you</span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{member.email}</TableCell>
                <TableCell>
                  <Badge variant={member.role === "admin" ? "default" : "muted"}>
                    {member.role}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <UserPlus className="h-3.5 w-3.5" />
        Invitees receive a link that activates their account and signs them in.
      </p>
    </div>
  );
}