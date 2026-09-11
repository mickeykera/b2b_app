"use client";

import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui";

export function RetryRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setWorking(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${runId}/retry`, { method: "POST" });
      const body = (await response.json()) as { error?: string; queued?: boolean };
      if (!response.ok || !body.queued) {
        setError(body.error ?? "Retry failed.");
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" onClick={retry} disabled={working}>
        {working ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCcw className="h-3.5 w-3.5" />
        )}
        Re-run
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}