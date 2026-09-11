import { NextResponse } from "next/server";

import { requireSessionFromRequest } from "@/lib/auth";
import { deleteCredential } from "@/lib/data/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ credentialId: string }> },
) {
  const session = await requireSessionFromRequest(request);
  const { credentialId } = await params;
  try {
    await deleteCredential(session.org, credentialId, session.sub);
  } catch (cause) {
    return NextResponse.json({ error: (cause as Error).message }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}