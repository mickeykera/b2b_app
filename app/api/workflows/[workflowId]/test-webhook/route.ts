import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import { getWorkflow } from "@/lib/data/workflows";
import { resolveWebhookEndpoint } from "@/lib/data/webhooks";
import { prisma } from "@/lib/db";
import { computeHmac } from "@/lib/sig";
import { env } from "@/lib/env";
import { requestLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const testSchema = z.object({
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

const DEFAULT_PAYLOAD = {
  id: "demo_1",
  type: "order.created",
  data: {
    customer: { id: "cus_123", email: "buyer@example.com" },
    total: 199.99,
    currency: "USD",
  },
};

/**
 * Replays a real, signed delivery against the ingest route: builds an HMAC
 * signature using the workflow's live webhook secret and self-posts to the
 * public webhook URL so signature checks, rate limits, and queueing all run
 * as they would for an external sender.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const log = requestLogger(request);
  const session = await requireSessionFromRequest(request);
  const { workflowId } = await params;

  const workflow = await getWorkflow(session.org, workflowId);
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
  }
  const endpoint = workflow.webhookEndpoints.find((item) => item.enabled);
  if (!endpoint) {
    return NextResponse.json(
      { error: "This workflow has no enabled webhook endpoint." },
      { status: 400 },
    );
  }

  let payload: Record<string, unknown> = DEFAULT_PAYLOAD;
  try {
    const body = (await request.json()) as { payload?: Record<string, unknown> };
    const parsed = testSchema.safeParse(body);
    if (parsed.success && Object.keys(parsed.data.payload).length > 0) {
      payload = parsed.data.payload;
    }
  } catch {
    // empty body → default sample payload
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.org },
    select: { slug: true },
  });
  const resolved = await resolveWebhookEndpoint(session.org, workflowId, endpoint.slug);
  if (!resolved) {
    return NextResponse.json({ error: "Webhook endpoint is unavailable." }, { status: 404 });
  }

  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `sha256=${computeHmac(resolved.secret, `${timestamp}.${rawBody}`)}`;

  const url = `${env.APP_BASE_URL}/api/webhooks/${org.slug}/${endpoint.slug}`;
  let delivery: Response;
  try {
    delivery = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-signature": signature,
        "x-relay-timestamp": String(timestamp),
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    log.error("test webhook delivery failed", { workflowId, error: cause });
    return NextResponse.json(
      { error: "Could not reach the webhook endpoint (ingest unreachable)." },
      { status: 502 },
    );
  }

  let body: { ok?: boolean; run?: string; error?: string } = {};
  try {
    body = (await delivery.json()) as typeof body;
  } catch {
    // non-JSON ingest response
  }

  return NextResponse.json({
    ok: delivery.ok,
    status: delivery.status,
    run: body.run ?? null,
    note: body.error ?? undefined,
  });
}