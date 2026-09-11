"use client";

import { useRouter } from "next/navigation";
import { PlusCircle, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button, Input } from "@/components/ui";

export function CreateWorkflowForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          graph: minimalGraph(name.trim()),
        }),
      });
      const body = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !body.id) {
        setError(body.error ?? "Unable to create workflow.");
        return;
      }
      router.push(`/workflows/${body.id}`);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <form onSubmit={create} className="flex items-center gap-2">
      <Input
        placeholder="New workflow name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-56"
        aria-label="Workflow name"
      />
      <Button type="submit" disabled={working || !name.trim()}>
        {working ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <PlusCircle className="h-4 w-4" />
        )}
        Create
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </form>
  );
}

function minimalGraph(name: string) {
  const key = "t_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24);
  return {
    nodes: [
      {
        key,
        type: "trigger",
        label: "Webhook",
        config: { subtype: "webhook", endpointSlug: "inbound" },
      },
    ],
    edges: [],
  };
}