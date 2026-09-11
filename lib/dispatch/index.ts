import "server-only";

import { type DispatchResult, type RunContext } from "@/lib/dag/runner";
import { type ActionNode } from "@/lib/dag/schema";
import { interpolate } from "@/lib/path";

/**
 * Production action dispatchers.
 *
 * Each action subtype performs an outbound call. HTTP 5xx and network errors
 * are reported as `retryable` so the runner can apply exponential backoff with
 * jitter; 4xx responses are treated as permanent.
 *
 * Secrets (tokens, webhook URLs) are never stored in action configs — they are
 * referenced by `credentialId` and resolved (decrypted) by the worker through
 * `getCredentialSecret` at execution time.
 */

export interface DispatcherDeps {
  getCredentialSecret: (organizationId: string, credentialId: string) => Promise<string>;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function rootOf(context: RunContext): Record<string, unknown> {
  return { payload: context.payload, vars: context.vars };
}

function interpolateDeep(value: unknown, root: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return interpolate(value, root);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateDeep(item, root));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = interpolateDeep(item, root);
    }
    return out;
  }
  return value;
}

function truncateBody(text: string, maxLength = 4_000): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}… [truncated ${text.length - maxLength} chars]`;
}

async function httpFetch(
  deps: DispatcherDeps,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; timeoutMs?: number },
): Promise<DispatchResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
      redirect: "manual",
    });
    const status = response.status;
    const rawBody = await response.text();
    return {
      httpStatus: status,
      ok: status >= 200 && status < 300,
      retryable: status >= 500,
      output: {
        httpStatus: status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        body: truncateBody(rawBody),
      },
      errorMessage: status >= 400 ? `HTTP ${status} ${response.statusText}`.trim() : undefined,
    };
  } catch (cause) {
    const isAbort = cause instanceof Error && cause.name === "AbortError";
    return {
      httpStatus: null,
      ok: false,
      retryable: true,
      errorMessage: isAbort ? `Request timed out after ${timeoutMs}ms` : (cause as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function dispatchStep(
  node: ActionNode,
  context: RunContext,
  deps: DispatcherDeps,
): Promise<DispatchResult> {
  const config = node.config;
  const root = rootOf(context);
  const orgId = context.trace.organizationId;
  const resolveSecret = (credentialId: string) => deps.getCredentialSecret(orgId, credentialId);

  switch (config.subtype) {
    case "http": {
      const headers: Record<string, string> = {};
      for (const header of config.headers) {
        headers[header.name] = interpolate(header.value, root);
      }
      switch (config.auth.type) {
        case "bearer":
          headers["Authorization"] = `Bearer ${interpolate(config.auth.tokenTemplate, root)}`;
          break;
        case "bearer_credential": {
          const token = await resolveSecret(config.auth.credentialId);
          headers["Authorization"] = `Bearer ${token}`;
          break;
        }
        case "basic":
          headers["Authorization"] =
            "Basic " +
            Buffer.from(
              `${interpolate(config.auth.usernameTemplate, root)}:${interpolate(config.auth.passwordTemplate, root)}`,
              "utf8",
            ).toString("base64");
          break;
        case "api_key":
          headers[config.auth.name] = interpolate(config.auth.valueTemplate, root);
          break;
        case "none":
          break;
      }

      const body = config.payload ? JSON.stringify(interpolateDeep(config.payload, root)) : undefined;
      if (body !== undefined) {
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      }

      return httpFetch(deps, interpolate(config.url, root), {
        method: config.method,
        headers,
        body,
        timeoutMs: config.timeoutMs,
      });
    }

    case "slack": {
      const webhookUrl = await resolveSecret(config.credentialId);
      const body: Record<string, unknown> = { text: interpolate(config.text, root) };
      if (config.channel) {
        body.channel = interpolate(config.channel, root);
      }
      return httpFetch(deps, webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    case "discord": {
      const webhookUrl = await resolveSecret(config.credentialId);
      const body: Record<string, unknown> = { content: interpolate(config.content, root) };
      if (config.username) {
        body.username = interpolate(config.username, root);
      }
      return httpFetch(deps, webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    case "sendgrid": {
      const apiKey = await resolveSecret(config.credentialId);
      const body = {
        from: { email: interpolate(config.from, root) },
        personalizations: [
          {
            to: config.to.map((email) => ({ email: interpolate(email, root) })),
          },
        ],
        subject: interpolate(config.subject, root),
        content: [
          { type: "text/plain", value: interpolate(config.textTemplate, root) },
          ...(config.htmlTemplate
            ? [{ type: "text/html", value: interpolate(config.htmlTemplate, root) }]
            : []),
        ],
      };
      return httpFetch(deps, "https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    }

    case "hubspot": {
      const token = await resolveSecret(config.credentialId);
      const properties: Record<string, string> = {};
      for (const property of config.properties) {
        properties[property.name] = interpolate(property.valueTemplate, root);
      }
      const body = { properties };
      return httpFetch(deps, `https://api.hubapi.com/crm/v3/objects/${encodeURIComponent(config.objectType)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    }

    default: {
      const exhaustive: never = config;
      return {
        httpStatus: null,
        ok: false,
        retryable: false,
        errorMessage: `Unsupported action subtype: ${(exhaustive as { subtype: string }).subtype}`,
      };
    }
  }
}