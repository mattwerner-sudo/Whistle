import { db } from "../db";
import { paymentFailures, users } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { sendMail } from "./mailer";
import { getAppUrl } from "./app-url";

// Friendly copy for the most common Stripe failure / decline codes.
// Keys are tried in order: declineCode first, then errorCode.
const DECLINE_COPY: Record<string, string> = {
  insufficient_funds: "Your card was declined for insufficient funds. Use a different card or update your payment method to keep revealing contacts.",
  expired_card: "Your card has expired. Update your payment method to keep revealing contacts.",
  incorrect_cvc: "The security code on your card was incorrect. Update your payment method to continue.",
  generic_decline: "Your card was declined by your bank. Update your payment method or try another card to keep revealing contacts.",
  card_declined: "Your card was declined. Update your payment method or try another card to keep revealing contacts.",
  authentication_required: "Your bank requires extra authentication for this charge. Update your payment method to complete it.",
  no_customer: "We couldn't find a card on file. Add a payment method to keep revealing contacts.",
  no_payment_method: "We couldn't find a card on file. Add a payment method to keep revealing contacts.",
};

export interface DeclineDetails {
  errorCode?: string | null;
  declineCode?: string | null;
  message?: string | null;
  paymentIntentId?: string | null;
}

export function friendlyDeclineMessage(d: DeclineDetails): string {
  if (d.declineCode && DECLINE_COPY[d.declineCode]) return DECLINE_COPY[d.declineCode];
  if (d.errorCode && DECLINE_COPY[d.errorCode]) return DECLINE_COPY[d.errorCode];
  return "Your card couldn't be charged. Update your payment method to keep revealing contacts.";
}

// Debounce window: only one decline email per user per 24h, even if multiple
// reveals fail in a burst.
const EMAIL_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

export async function recordPaymentFailure(opts: {
  userId: number;
  staffId?: number;
  source: "payg" | "overage";
  amountCents: number;
  stripeCustomerId?: string | null;
  details: DeclineDetails;
}): Promise<void> {
  const [row] = await db
    .insert(paymentFailures)
    .values({
      userId: opts.userId,
      staffId: opts.staffId,
      source: opts.source,
      amountCents: opts.amountCents,
      stripeCustomerId: opts.stripeCustomerId ?? null,
      errorCode: opts.details.errorCode ?? null,
      declineCode: opts.details.declineCode ?? null,
      message: opts.details.message ?? null,
      paymentIntentId: opts.details.paymentIntentId ?? null,
    })
    .returning();

  // Send one notification email per user per debounce window. We claim the
  // right to send by doing an atomic UPDATE that succeeds only if no other
  // row for this user has been emailed within the window. Two concurrent
  // failures racing here will both attempt the UPDATE; only the first one
  // returns a row, so we never send duplicates.
  try {
    const cutoff = new Date(Date.now() - EMAIL_DEBOUNCE_MS);
    const claimed = await db
      .update(paymentFailures)
      .set({ emailedAt: new Date() })
      .where(
        and(
          eq(paymentFailures.id, row.id),
          sql`NOT EXISTS (
            SELECT 1 FROM ${paymentFailures} AS pf2
            WHERE pf2.user_id = ${opts.userId}
              AND pf2.id <> ${row.id}
              AND pf2.emailed_at IS NOT NULL
              AND pf2.emailed_at > ${cutoff}
          )`,
        ),
      )
      .returning({ id: paymentFailures.id });
    if (claimed.length === 0) return; // another concurrent failure already emailed

    const [user] = await db.select().from(users).where(eq(users.id, opts.userId)).limit(1);
    if (!user) return;

    const link = `${getAppUrl()}/settings/billing`;
    const body = [
      `Hi ${user.fullName || "there"},`,
      "",
      friendlyDeclineMessage(opts.details),
      "",
      `Update your payment method here: ${link}`,
      "",
      "Until your card is updated, contact reveals will be paused.",
      "",
      "— Whistle",
    ].join("\n");

    const mail = await sendMail({
      to: user.email,
      subject: "Action needed: your Whistle payment was declined",
      text: body,
    });
    if (!mail.delivered && mail.reason !== "no_api_key") {
      // SendGrid rejected the message — release the claim so a future
      // failure can try again rather than going dark for 24h.
      await db
        .update(paymentFailures)
        .set({ emailedAt: null })
        .where(eq(paymentFailures.id, row.id));
    }
  } catch (err) {
    console.error("[PaymentDecline] notification failed:", err);
    // Best-effort: release the claim so we can retry on the next failure.
    try {
      await db
        .update(paymentFailures)
        .set({ emailedAt: null })
        .where(eq(paymentFailures.id, row.id));
    } catch { /* ignore */ }
  }
}
