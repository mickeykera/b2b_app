"use client";

import { useState } from "react";
import { Loader2, Smartphone } from "lucide-react";

import { Badge, Button } from "@/components/ui";

export interface SessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  current: boolean;
}

interface SessionsListProps {
  initialSessions: SessionRow[];
  currentId?: string | null;
}

export function SessionsList({ initialSessions, currentId }: SessionsListProps) {
  const [sessions, setSessions] = useState(initialSessions);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(sessionId: string) {
    setBusyId(sessionId);
    setError(null);
    try {
      const response = await fetch("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        setError(body.error ?? "Could not revoke session.");
        return;
      }
      setSessions(sessions.map((s) => (s.id === sessionId ? { ...s, revokedAt: new Date() } : s)));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {sessions.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No active sessions.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">
                    {session.userAgent || "Unknown device"}
                    {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {session.current
                      ? "Current session"
                      : session.revokedAt
                        ? `Revoked ${session.revokedAt.toLocaleString()}`
                        : session.expiresAt
                          ? `Expires ${session.expiresAt.toLocaleString()}`
                          : "Session"}
                  </div>
                </div>
                {session.current && <Badge variant="success">active</Badge>}
              </div>
              {!session.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === session.id || session.revokedAt != null}
                  onClick={() => revoke(session.id)}
                  className="shrink-0"
                >
                  {busyId === session.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Revoke"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {currentId && (
        <p className="text-[10px] text-muted-foreground">
          Sessions are tracked server-side and can be revoked at any time.
        </p>
      )}
    </div>
  );
}