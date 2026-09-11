"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";

type TriggerKind = "webhook" | "schedule";
type ActionKind = "slack" | "http";

interface CredentialOption {
  id: string;
  name: string;
  provider: string;
}

interface BuilderProps {
  credentials: CredentialOption[];
}

export function WorkflowBuilder({ credentials }: BuilderProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [triggerKind, setTriggerKind] = useState<TriggerKind>("webhook");
  const [slug, setSlug] = useState("my-webhook");
  const cronValidator = /^(\S+\s\S+\s\S+\s\S+\s\S+)$/;
  const [cron, setCron] = useState("0 9 * * 1");
  const [timezone, setTimezone] = useState("Etc/UTC");
  const [actionKind, setActionKind] = useState<ActionKind>("slack");
  const [credentialId, setCredentialId] = useState("");
  const [slackText, setSlackText] = useState("New order received: {{ $.payload.data.email }}");
  const [httpMethod, setHttpMethod] = useState("POST");
  const [httpUrl, setHttpUrl] = useState("https://api.example.com/hook");
  const [httpPayload, setHttpPayload] = useState('{\n  "source": "relayflow"\n}');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slackCredentials = credentials.filter((credential) => credential.provider === "slack");

  async function create() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (triggerKind === "webhook" && !/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)) {
      setError("Endpoint slug must be 3-64 chars of lowercase letters, digits, and dashes.");
      return;
    }
    if (triggerKind === "schedule" && !cronValidator.test(cron)) {
      setError("Cron must be a 5-field expression (e.g. `0 9 * * 1`).");
      return;
    }
    if (actionKind === "slack") {
      if (!credentialId) {
        setError("A Slack credential is required.");
        return;
      }
      if (!slackText.trim()) {
        setError("Slack message text is required.");
        return;
      }
    } else {
      if (!httpUrl.trim()) {
        setError("Action URL is required.");
        return;
      }
      try {
        JSON.parse(httpPayload || "{}");
      } catch {
        setError("Action payload is not valid JSON.");
        return;
      }
    }

    setWorking(true);
    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), graph: buildGraph() }),
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

  function buildGraph() {
    const triggerConfig =
      triggerKind === "webhook"
        ? { subtype: "webhook", endpointSlug: slug }
        : { subtype: "schedule", cron, timezone };
    const actionConfig =
      actionKind === "slack"
        ? { subtype: "slack", credentialId, text: slackText }
        : {
            subtype: "http",
            method: httpMethod,
            url: httpUrl,
            headers: [],
            auth: { type: "none" },
            payload: JSON.parse(httpPayload || "{}") as Record<string, unknown>,
            timeoutMs: 10_000,
          };
    return {
      nodes: [
        { key: "trigger", type: "trigger", config: triggerConfig },
        { key: "action_1", type: "action", config: actionConfig },
      ],
      edges: [{ from: "trigger", to: "action_1" }],
    };
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Configure</CardTitle>
          <CardDescription>
            Define the pipeline shape. You can add filters and transforms from
            the raw graph editor afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wf-name">Workflow name</Label>
            <Input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sales order pipeline"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Trigger</Label>
            <Select
              value={triggerKind}
              onChange={(e) => setTriggerKind(e.target.value as TriggerKind)}
            >
              <option value="webhook">Webhook (HTTP delivery)</option>
              <option value="schedule">Schedule (cron)</option>
            </Select>
            {triggerKind === "webhook" ? (
              <div className="space-y-1.5">
                <Label htmlFor="wf-slug">Endpoint slug</Label>
                <Input
                  id="wf-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/g, "").toLowerCase())}
                />
                <p className="text-[10px] text-muted-foreground">
                  Lowercase letters, digits, and dashes (3–64 chars).
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="wf-cron">Cron</Label>
                  <Input
                    id="wf-cron"
                    value={cron}
                    onChange={(e) => setCron(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wf-tz">Timezone</Label>
                  <Input
                    id="wf-tz"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Action</Label>
            <Select value={actionKind} onChange={(e) => setActionKind(e.target.value as ActionKind)}>
              <option value="slack">Post to Slack</option>
              <option value="http">HTTP request</option>
            </Select>
            {actionKind === "slack" ? (
              <div className="space-y-1.5">
                <div className="space-y-1.5">
                  <Label htmlFor="wf-slack-cred">Slack credential</Label>
                  <Select
                    id="wf-slack-cred"
                    value={credentialId}
                    onChange={(e) => setCredentialId(e.target.value)}
                  >
                    <option value="">— select —</option>
                    {slackCredentials.map((credential) => (
                      <option key={credential.id} value={credential.id}>
                        {credential.name}
                      </option>
                    ))}
                  </Select>
                  {slackCredentials.length === 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      No Slack credentials yet — add one under Credentials.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wf-slack-text">Message template</Label>
                  <Textarea
                    id="wf-slack-text"
                    value={slackText}
                    onChange={(e) => setSlackText(e.target.value)}
                    className="min-h-[64px]"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Interpolate event fields with {"{{ $.payload.path }}"} syntax.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <div>
                    <Label htmlFor="wf-http-method">Method</Label>
                    <Select
                      id="wf-http-method"
                      value={httpMethod}
                      onChange={(e) => setHttpMethod(e.target.value)}
                    >
                      {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wf-http-url">URL</Label>
                    <Input
                      id="wf-http-url"
                      value={httpUrl}
                      onChange={(e) => setHttpUrl(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wf-http-payload">Payload (JSON)</Label>
                  <Textarea
                    id="wf-http-payload"
                    value={httpPayload}
                    onChange={(e) => setHttpPayload(e.target.value)}
                    className="min-h-[80px] mono"
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={create} disabled={working} className="w-full">
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Create workflow
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:mt-2">
        <CardHeader>
          <CardTitle>Pipeline preview</CardTitle>
          <CardDescription>
            The exact DAG that will be validated and stored.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="mono max-h-[420px] overflow-auto rounded-md border border-border bg-muted p-3 text-xs">
            {JSON.stringify(buildGraph(), null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}