import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/src/generated/prisma/client";
import { hashPassword } from "@/lib/passwords";
import { encryptSecret } from "@/lib/crypto";
import { hashApiKey } from "@/lib/data/auth";
import { createWorkflow, updateWorkflow, setWorkflowStatus } from "@/lib/data/workflows";
import { newId } from "@/lib/ids";

/**
 * Development seed. Creates a demo org + admin user, one webhook-triggered
 * workflow, and (if not yet configured) one API key with a known secret.
 *
 * Requires DATABASE_URL + MASTER_ENCRYPTION_KEY to be exported (run via
 * `npm run db:seed` after `npm run db:generate`).
 */

const DEMO_ORG_SLUG = process.env.BOOTSTRAP_ORG_SLUG ?? "acme";
const DEMO_ORG_NAME = process.env.BOOTSTRAP_ORG_NAME ?? "Acme Corp";
const DEMO_ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@acme.dev";
const DEMO_ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "RelayFlow-Dev-123!";
const DEMO_API_KEY_SECRET = "rf_sk_test_00000000000000000000000000000000";

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const org = await prisma.organization.upsert({
    where: { slug: DEMO_ORG_SLUG },
    update: {},
    create: { slug: DEMO_ORG_SLUG, name: DEMO_ORG_NAME },
  });

  const admin = await prisma.user.upsert({
    where: { email: DEMO_ADMIN_EMAIL },
    update: {},
    create: {
      email: DEMO_ADMIN_EMAIL,
      name: "Acme Admin",
      role: "admin",
      organizationId: org.id,
      passwordHash: await hashPassword(DEMO_ADMIN_PASSWORD),
    },
  });

  const workflowGraph = {
    nodes: [
      {
        key: "t_order",
        type: "trigger",
        config: { subtype: "webhook", endpointSlug: "orders" },
      },
      {
        key: "f_high_value",
        type: "filter",
        config: {
          mode: "all",
          conditions: [
            { path: "$.payload.amount", operator: "gte", value: 1000 },
          ],
        },
      },
      {
        key: "a_notify",
        type: "action",
        config: {
          subtype: "slack",
          credentialId: "slack-webhook",
          text: "New high-value order {{$.payload.amount}} for {{$.payload.order_id}}",
        },
      },
    ],
    edges: [
      { from: "t_order", to: "f_high_value" },
      { from: "f_high_value", to: "a_notify" },
    ],
  } as const;

  const credential = await prisma.credential.findFirst({
    where: { organizationId: org.id, name: "slack-webhook" },
  });
  if (!credential) {
    await prisma.credential.create({
      data: {
        organizationId: org.id,
        name: "slack-webhook",
        provider: "slack",
        secretCiphertext: encryptSecret(
          org.id,
          "https://hooks.slack.com/services/T0000/B0000/XXXXXXXXXXXX",
        ),
        secretIv: "",
        maskedValue: "https://hooks.slack.com/…/XXXXXXXXXXXX",
      },
    });
  }

  let existing = await prisma.workflow.findFirst({
    where: { organizationId: org.id, name: "Order notifications" },
  });
  // Go through the org-scoped repository so the graph projection
  // (triggers, actions, webhook endpoints + HMAC secrets) stays consistent.
  if (existing) {
    await updateWorkflow(org.id, existing.id, {
      name: "Order notifications",
      description: "Receives order events and posts a Slack notification.",
      graph: workflowGraph as never,
    });
  } else {
    const created = await createWorkflow(org.id, {
      name: "Order notifications",
      description: "Receives order events and posts a Slack notification.",
      graph: workflowGraph as never,
    }, admin.id);
    existing = await prisma.workflow.findFirst({
      where: { organizationId: org.id, id: created.id },
    });
  }
  if (existing && existing.status !== "active") {
    await setWorkflowStatus(org.id, existing.id, "active", admin.id);
  }

  const endpoint = existing
    ? await prisma.webhookEndpoint.findFirst({
        where: { workflowId: existing.id },
      })
    : null;
  const webhookUrl = endpoint
    ? `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/webhooks/${org.slug}/${endpoint.slug}`
    : null;
  if (webhookUrl) {
    console.log(`  webhook:  ${webhookUrl}`);
  }

  const existingKey = await prisma.apiKey.findFirst({
    where: { organizationId: org.id },
    select: { id: true },
  });
  if (!existingKey) {
    await prisma.apiKey.create({
      data: {
        id: newId("key_"),
        organizationId: org.id,
        userId: admin.id,
        name: "Development key",
        keyPrefix: DEMO_API_KEY_SECRET.slice(0, 12),
        keyHash: hashApiKey(DEMO_API_KEY_SECRET),
      },
    });
  }

  console.log("Seeded:");
  console.log(`  org:      ${DEMO_ORG_SLUG}`);
  console.log(`  login:    ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
  console.log(`  api key:  ${DEMO_API_KEY_SECRET}`);

  const connection = prisma;
  await connection.$disconnect();

  // The org-scoped repository uses the app's singleton client; close its pool too.
  const { prisma: appPrisma } = await import("@/lib/db");
  await appPrisma.$disconnect();
}

await main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});