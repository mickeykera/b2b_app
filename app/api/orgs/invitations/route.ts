import { NextResponse } from "next/server";

import { z } from "zod";

import { requireSessionFromRequest } from "@/lib/auth";
import {
  createInvitation,
  listInvitations,
} from "@/lib/data/invitations";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { zEmail, zInviteRole } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inviteSchema = z.object({
  email: zEmail,
  role: zInviteRole,
});

export async function POST(request: Request) {
  const session = await requireSessionFromRequest(request);
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const { email, role } = parsed.data;

  const existingUser = await prisma.user.findFirst({
    where: { organizationId: session.org, email },
    select: { id: true },
  });
  if (existingUser) {
    return NextResponse.json({ error: "A member with this email already exists." }, { status: 409 });
  }
  const open = await listInvitations(session.org);
  if (open.some((inv) => inv.email === email && !inv.acceptedAt && !inv.revokedAt)) {
    return NextResponse.json({ error: "An active invitation already exists for this email." }, { status: 409 });
  }

  const { token, invitation } = await createInvitation({
    organizationId: session.org,
    invitedById: session.sub,
    email,
    role,
  });
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.org },
    select: { name: true },
  });
  const link = `${env.APP_BASE_URL}/invite/${token}`;
  await sendEmail({
    to: email,
    subject: `You've been invited to ${org.name} on RelayFlow`,
    text: `${session.email} invited you to join ${org.name} on RelayFlow.\n\nAccept the invitation from this link (valid for 7 days):\n${link}\n\nIf the link expires, ask an admin to send a new invitation.`,
  });

  return NextResponse.json({
    ok: true,
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    },
  });
}

export async function GET(request: Request) {
  const session = await requireSessionFromRequest(request);
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const rows = await listInvitations(session.org);
  return NextResponse.json({ invitations: rows });
}