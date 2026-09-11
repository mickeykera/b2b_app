"use client";

import { useRouter } from "next/navigation";
import { PlusCircle, Loader2 } from "lucide-react";
import { useState } from "react";

import {
  Button,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";

const PROVIDERS = [
  "generic",
  "http",
  "slack",
  "discord",
  "sendgrid",
  "hubspot",
];

export function NewCredentialForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("generic");
  const [secret, setSecret] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), provider, secret }),
      });
      const body = (await response.json()) as {
        error?: string;
        id?: string;
        maskedValue?: string;
      };
      if (!response.ok || !body.id) {
        setError(body.error ?? "Unable to save credential.");
        return;
      }
      setOpen(false);
      setName("");
      setProvider("generic");
      setSecret("");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setWorking(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusCircle className="h-4 w-4" /> New credential
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm space-y-3 rounded-md border border-border bg-card p-4 shadow-sm"
    >
      <div className="space-y-1.5">
        <Label htmlFor="cred-name">Name</Label>
        <Input
          id="cred-name"
          placeholder="slack-webhook"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cred-provider">Provider</Label>
        <Select
          id="cred-provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          {PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cred-secret">Secret / token / URL</Label>
        <Textarea
          id="cred-secret"
          placeholder="sk-…"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          required
        />
        <p className="text-[10px] text-muted-foreground">
          Encrypted with AES-256-GCM under your organization key. Never shown again.
        </p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={working || !name.trim() || !secret}>
          {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}