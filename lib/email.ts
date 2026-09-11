import "server-only";

import { env } from "@/lib/env";

/**
 * Outbound email transport.
 *
 * Two transports, zero dependencies:
 *   - console  (default): prints the message and returns the URL the message
 *     would have linked to. Used in development/preview so flows complete
 *     without an SMTP provider.
 *   - resend   (EMAIL_RESEND_API_KEY set): real delivery via the Resend HTTP
 *     API ("/emails", JSON).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface SentEmail {
  transport: "console" | "resend";
  messageId?: string;
}

export async function sendEmail(message: EmailMessage): Promise<SentEmail> {
  if (env.EMAIL_RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.EMAIL_RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!response.ok) {
      throw new Error(`resend failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { id?: string };
    return { transport: "resend", messageId: body.id };
  }
  console.log(`\n[email][console] to=${message.to} subject="${message.subject}"\n${message.text}\n`);
  return { transport: "console" };
}

export function magicLink(path: string, token: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;
}