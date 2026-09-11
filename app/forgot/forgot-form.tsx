"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { Button, Input, Label } from "@/components/ui";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setState("submitting");
    setError(null);
    try {
      const response = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok && response.status !== 429) {
        setError("Something went wrong. Please try again.");
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("Network error. Please try again.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        If that email is registered, a reset link is on its way. It expires in
        one hour.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <span className="relative block">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            className="pl-9"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </span>
      </div>
      <Button type="submit" className="w-full" disabled={state === "submitting"}>
        {state === "submitting" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Send reset link"
        )}
      </Button>
    </form>
  );
}