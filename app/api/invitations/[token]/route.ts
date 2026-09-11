import { NextResponse } from "next/server";

import { z } from "zod";

import { resolveInvitation, acceptInvitation } from "@/lib/data/invitations";
import { prisma } from "@/lib/db";
import { issueSessionToken } from "@/lib/data/sessions";
import { buildSessionCookie } from "@/lib/jwt";
import { extractClientIp } from "@/lib/auth";
import { zPassword } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ token: string }>;
}

/** Public: previews an invitation before the invitee submits credentials. */
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const invitation = await resolveInvitation(token);
  if (!invitation) {
    return NextResponse.json({ error: "This invitation is invalid or has expired." }, { status: 404 });
  }
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: invitation.organizationId },
    select: { name: true },
  });
  return NextResponse.json({
    email: invitation.email,
    role: invitation.role,
    organizationName: org.name,
    expiresAt: invitation.expiresAt,
  });
}

const acceptSchema = z.object({
  name: z.string().trim().min(1).max(120),
  password: zPassword,
});

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const account = await acceptInvitation({
    token,
    name: parsed.data.name,
    password: parsed.data.password,
  });
  if (!account) {
    return NextResponse.json({ error: "This invitation is invalid, expired, or the email is already registered." }, { status: 400 });
  }
  const sessionToken = await issueSessionToken(
    {
      sub: account.userId,
      org: account.organizationId,
      role: "member",
      email: account.email,
      name: parsed.data.name,
    },
    { userId: account.userId, ipAddress: extractClientIp(request) },
  );
  const response = NextResponse.json({ ok: true });
  response.headers.append("Set-Cookie", buildSessionCookie(sessionToken));
  return response;
}