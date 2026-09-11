import { NextResponse } from "next/server";

import { requestPasswordReset } from "@/lib/data/auth";
import { sendEmail, magicLink } from "@/lib/email";
import { extractClientIp } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { zEmail } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Password reset request. Always answers 200 for a known pattern to avoid
 * account enumeration; successful requests are logged as audit events.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const emailValue = (body as { email?: unknown } | null)?.email;
  const parsed = zEmail.safeParse(emailValue);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }
  const email = parsed.data;
  const token = await requestPasswordReset(email);
  if (token) {
    const link = magicLink("/reset", token);
    await sendEmail({
      to: email,
      subject: "Reset your RelayFlow password",
      text: `We received a request to reset the password for ${email}.\n\nOpen this link within the next hour to choose a new password:\n${link}\n\nIf you did not request this, you can safely ignore this email.`,
    });
    await recordAudit({
      organizationId: null,
      action: "auth.password_reset_requested",
      ipAddress: extractClientIp(request),
      metadata: { email },
    });
  }
  return NextResponse.json({ ok: true });
}