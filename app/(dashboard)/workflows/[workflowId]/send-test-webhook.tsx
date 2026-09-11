"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";

import { Button, Textarea } from "@/components/ui";

const SAMPLE = `{
  "id": "demo_1",
  "type": "order.created",
  "data": {
    "customer": { "id": "cus_123", "email": "buyer@example.com" },
    "total": 199.99,
    "currency": "USD"
  }
}`;

interface SendResult {
  ok?: boolean;
  run?: string | null;
  status?: number;
  error?: string;
}

/** Sends a signed webhook delivery to this workflow's own ingest endpoint. */
export function SendTestWebhook({ workflowId }: { workflowId: string }) {
  const [payload, setPayload] = useState(SAMPLE);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload);
    } catch {
      setResult({ ok: false, error: "Payload is not valid JSON." });
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(`/api/workflows/${workflowId}/test-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: parsed }),
      });
      const body = (await response.json()) as SendResult;
      setResult(body);
    } catch {
      setResult({ ok: false, error: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Textarea
        aria-label="Test webhook payload (JSON)"
        value={payload}
        onChange={(e) => setPayload(e.target.value)}
        className="min-h-[0px] h-9 resize-none py-1.5 text-xs mono"
      />
      <Button
        size="sm"
        variant="outline"
        onClick={send}
        disabled={busy}
        className="shrink-0"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Send test
      </Button>
      {result && (
        <span
          className={`text-xs ${result.ok ? "text-success" : "text-destructive"}`}
        >
          {result.ok ? "Accepted" : "Rejected"}
          {result.run && (
            <>
              {" · "}
              <code className="mono">{result.run}</code>
            </>
          )}
        </span>
      )}
    </div>
  );
}