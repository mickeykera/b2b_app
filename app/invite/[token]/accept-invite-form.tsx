"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, User } from "lucide-react";

import { Button, Input, Label } from "@/components/ui";

interface InvitationPreview {
  email: string;
  role: string;
  organizationName: string;
  expiresAt: string;
}

export function AcceptInviteForm() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token ?? "";
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/invitations/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("invalid");
        }
        const data = (await response.json()) as InvitationPreview;
        if (!cancelled) {
          setPreview(data);
          setName(data.email.split("@")[0] ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotFound(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (notFound) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        This invitation is invalid or has expired. Ask an admin to send a new
        one.
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking invitation…
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        setError(body.error ?? "Could not accept the invitation.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {preview.organizationName} has invited <strong>{preview.email}</strong>{" "}
        as {preview.role}.
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="name">Full name</Label>
        <span className="relative block">
          <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="name"
            autoComplete="name"
            required
            className="pl-9"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </span>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Activate account"}
      </Button>
    </form>
  );
}