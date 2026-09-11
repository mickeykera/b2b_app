import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/src/generated/prisma/client";

import { env } from "@/lib/env";

/**
 * Prisma client bound to a PostgreSQL connection through the `pg` driver
 * adapter. Uses the pooled `DATABASE_URL` by default (Neon/Supabase pooler).
 * A connection is established lazily on first query; configuration errors
 * surface immediately via the `lib/env` validator (see env.mjs).
 */

declare global {
  var __relayflowPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
  });
  return new PrismaClient({ adapter });
}

function getClient(): PrismaClient {
  if (process.env.NODE_ENV !== "production") {
    globalThis.__relayflowPrisma ??= createClient();
    return globalThis.__relayflowPrisma;
  }
  return createClient();
}

export const prisma = getClient();

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}