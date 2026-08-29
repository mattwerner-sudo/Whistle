/**
 * Minimal transactional mailer.
 *
 * Uses SendGrid HTTP API when SENDGRID_API_KEY is set. Otherwise logs the
 * message to the console as a non-blocking no-op so dev/test environments
 * don't fail.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export async function sendMail(msg: MailMessage): Promise<{ delivered: boolean; reason?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.MAIL_FROM || "noreply@whistle.app";

  if (!apiKey) {
    console.log(`[Mailer] (no SENDGRID_API_KEY) would send to=${msg.to} subject="${msg.subject}"`);
    console.log(`[Mailer] body: ${msg.text.slice(0, 500)}`);
    return { delivered: false, reason: "no_api_key" };
  }

  try {
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: from },
        reply_to: msg.replyTo ? { email: msg.replyTo } : undefined,
        subject: msg.subject,
        content: [{ type: "text/plain", value: msg.text }],
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[Mailer] SendGrid error ${resp.status}: ${body.slice(0, 300)}`);
      return { delivered: false, reason: `sendgrid_${resp.status}` };
    }
    return { delivered: true };
  } catch (err: any) {
    console.error(`[Mailer] send failed:`, err?.message || err);
    return { delivered: false, reason: "exception" };
  }
}

export function getFounderEmail(): string {
  return process.env.FOUNDER_EMAIL || process.env.SALES_INBOX || "founder@whistle.app";
}
