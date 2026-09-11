import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { verifyWebhookSignature, type SignatureScheme } from "@/lib/sig";
import { deriveExecutionId } from "@/lib/ids";
import { resolveOrganizationBySlug } from "@/lib/data/workflows";
import { resolveWebhookEndpoint } from "@/lib/data/webhooks";
import { enqueueWorkflowRun } from "@/lib/queue";
import { extractClientIp } from "@/lib/auth";
import {
  consumeBucket,
  ipBucket,
  tenantBucket,
  webhookBucket,
  type RateLimitDecision,
} from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function detectScheme(headers: Headers): SignatureScheme {
  if (headers.has("stripe-signature")) {
    return "stripe";
  }
  if (headers.has("x-hub-signature-256")) {
    return "github";
  }
  return "relay";
}

function rateLimitResponse(decision: RateLimitDecision): NextResponse {
  return NextResponse.json(
    { error: "Rate limit exceeded. Slow down and try again." },
    { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; endpoint: string }> },
) {
  const ip = extractClientIp(request);

  const ipGate = await consumeBucket(ipBucket(ip));
  if (!ipGate.allowed) {
    return rateLimitResponse(ipGate);
  }

  const { org, endpoint } = await params;
  const contentLength = Number(request.headers.get("content-length") ?? -1);
  if (contentLength > env.WEBHOOK_BODY_SIZE_LIMIT_BYTES) {
    return NextResponse.json(
      { error: "Request body is too large." },
      { status: 413 },
    );
  }

  const rawBody = await request.text();
  if (rawBody.length > env.WEBHOOK_BODY_SIZE_LIMIT_BYTES) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  const organization = await resolveOrganizationBySlug(org);
  if (!organization) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const tenantGate = await consumeBucket(tenantBucket(organization.id, "webhooks"));
  if (!tenantGate.allowed) {
    return rateLimitResponse(tenantGate);
  }

  const endpointGate = await consumeBucket(webhookBucket(endpoint));
  if (!endpointGate.allowed) {
    return rateLimitResponse(endpointGate);
  }

  const resolved = await resolveWebhookEndpoint(organization.id, null, endpoint);
  if (!resolved) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (resolved.workflowStatus !== "active") {
    return NextResponse.json({ ok: true, skipped: "workflow_not_active" });
  }

  const scheme = detectScheme(request.headers);
  const verification = verifyWebhookSignature({
    rawBody,
    secret: resolved.secret,
    scheme,
    signature:
      scheme === "stripe"
        ? request.headers.get("stripe-signature")
        : scheme === "github"
          ? request.headers.get("x-hub-signature-256")
          : request.headers.get("x-relay-signature"),
    timestamp: scheme === "relay" ? request.headers.get("x-relay-timestamp") : undefined,
    maxAgeSeconds: env.WEBHOOK_MAX_AGE_SECONDS,
  });

  if (!verification.ok) {
    return NextResponse.json(
      { error: "Invalid signature." },
      { status: 401, headers: { "X-Relayflow-Reason": verification.reason } },
    );
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    parsedPayload = { raw: rawBody };
  }

  const eventId = `evt_${Buffer.from(rawBody).subarray(0, 24).toString("hex")}-${Date.now()}`;
  const occurredAtMs = Date.now();
  const executionId = deriveExecutionId(organization.id, resolved.workflowId, eventId, occurredAtMs);

  await enqueueWorkflowRun({
    type: "webhook",
    organizationId: organization.id,
    workflowId: resolved.workflowId,
    executionId,
    event: {
      id: eventId,
      occurredAtMs,
      payload: parsedPayload as Record<string, unknown>,
    },
  });

  return NextResponse.json({ ok: true, run: executionId, queued: true });
}