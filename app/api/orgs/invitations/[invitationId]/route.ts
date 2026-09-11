import { NextResponse } from "next/server";

import { requireSessionFromRequest } from "@/lib/auth";
import { revokeInvitation } from "@/lib/data/invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ invitationId: string }>;
}

export async function DELETE(request: Request, { params }: Params) {
  const session = await requireSessionFromRequest(request);
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { invitationId } = await params;
  const revoked = await revokeInvitation(session.org, invitationId, session.sub);
  if (!revoked) {
    return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}