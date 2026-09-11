import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import {
  createCredential,
  listCredentials,
  CREDENTIAL_PROVIDERS,
} from "@/lib/data/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  provider: z.enum(CREDENTIAL_PROVIDERS),
  secret: z.string().min(1).max(8_192),
  metadata: z.record(z.string(), z.unknown()).optional().or(z.null()),
});

export async function GET(request: Request) {
  const session = await requireSessionFromRequest(request);
  const credentials = await listCredentials(session.org);
  return NextResponse.json({ credentials });
}

export async function POST(request: Request) {
  const session = await requireSessionFromRequest(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed.", details: parsed.error.flatten() }, { status: 400 });
  }

  const created = await createCredential(session.org, {
    name: parsed.data.name,
    provider: parsed.data.provider,
    secret: parsed.data.secret,
    metadata: parsed.data.metadata ?? null,
    createdBy: session.sub,
  });
  return NextResponse.json(created, { status: 201 });
}