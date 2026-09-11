"use client";

import { useRouter } from "next/navigation";
import { Loader2, Play, Pause, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui";

export function WorkflowActions({
  workflowId,
  status,
}: {
  workflowId: string;
  status: string;
}) {
  const router = useRouter();
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(payload: { active: boolean } | { test: boolean }, key: string) {
    setError(null);
    setAction(key);
    try {
      const url =
        key === "test"
          ? `/api/workflows/${workflowId}/test-run`
          : `/api/workflows/${workflowId}/toggle`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(key === "test" ? { payload: {} } : payload),
      });
      const body = (await response.json()) as { error?: string; ok?: boolean };
      if (!response.ok || !body.ok) {
        setError(body.error ?? "Request failed.");
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setAction(null);
    }
  }

  async function remove() {
    if (!confirm("Delete this workflow permanently?")) return;
    setError(null);
    setAction("delete");
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "Delete failed.");
        return;
      }
      router.replace("/workflows");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setAction(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {status === "active" ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => run({ active: false }, "toggle")}
            disabled={action !== null}
          >
            {action === "toggle" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Pause className="h-3.5 w-3.5" />
            )}
            Pause
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => run({ active: true }, "toggle")}
            disabled={action !== null}
          >
            {action === "toggle" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Activate
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => run({ test: true }, "test")}
          disabled={action !== null}
        >
          {action === "test" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Test run
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={remove}
          disabled={action !== null}
          className="text-destructive hover:text-destructive"
        >
          {action === "delete" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}