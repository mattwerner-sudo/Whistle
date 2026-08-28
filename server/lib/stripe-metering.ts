import { getUncachableStripeClient } from "../stripeClient";

export interface MeteringDecline {
  errorCode?: string | null;
  declineCode?: string | null;
  message?: string | null;
  paymentIntentId?: string | null;
}

/**
 * Resolve which card to charge off-session for a customer.
 *
 * Prefers the customer's configured default payment method (set when the PAYG
 * card-on-file checkout completes). If that isn't set for some reason, falls
 * back to the most recently attached card so a saved card is never silently
 * ignored. Returns null only when the customer truly has no card on file.
 */
export async function resolveDefaultPaymentMethod(
  stripe: { customers: any; paymentMethods: any },
  customerId: string,
): Promise<string | null> {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer && !customer.deleted) {
    const dpm = customer.invoice_settings?.default_payment_method;
    if (dpm) return typeof dpm === "string" ? dpm : dpm.id;
  }
  const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
  return pms.data?.[0]?.id ?? null;
}

/**
 * Charge for one reveal.
 *
 * - PAYG (no active subscription): create an off-session PaymentIntent against
 *   the customer's default payment method and confirm immediately. The reveal
 *   is only granted if Stripe returns status `succeeded` (or `processing`).
 * - Overage (active subscription): add an invoice item to the customer; it
 *   will be collected on the next subscription invoice cycle. We still require
 *   the create call to succeed before granting the reveal.
 *
 * On failure, `decline` captures the Stripe error code / decline code so the
 * caller can show actionable copy and store a payment_failures row.
 */
export async function meterRevealCharge(opts: {
  stripeCustomerId: string | null | undefined;
  amountCents: number;
  description: string;
  userId: number;
  staffId: number;
  source: "payg" | "overage";
}): Promise<{ ok: boolean; reason?: string; chargeId?: string; decline?: MeteringDecline }> {
  if (!opts.stripeCustomerId) {
    return {
      ok: false,
      reason: "no_customer",
      decline: { errorCode: "no_customer", message: "No payment method on file" },
    };
  }
  if (opts.amountCents <= 0) return { ok: true };

  try {
    const stripe = await getUncachableStripeClient();
    const metadata = {
      userId: String(opts.userId),
      staffId: String(opts.staffId),
      source: opts.source,
    };

    if (opts.source === "payg") {
      // Off-session charges must name the card explicitly — relying on an unset
      // customer default fails even when a valid card is on file. Resolve the
      // saved card (default first, most-recent fallback) and charge it directly.
      const paymentMethodId = await resolveDefaultPaymentMethod(stripe, opts.stripeCustomerId);
      if (!paymentMethodId) {
        return {
          ok: false,
          reason: "no_payment_method",
          decline: { errorCode: "no_payment_method", message: "No payment method on file" },
        };
      }
      const intent = await stripe.paymentIntents.create({
        customer: opts.stripeCustomerId,
        amount: opts.amountCents,
        currency: "usd",
        description: opts.description,
        payment_method: paymentMethodId,
        confirm: true,
        off_session: true,
        metadata,
      });
      if (intent.status !== "succeeded" && intent.status !== "processing") {
        const lastErr = intent.last_payment_error;
        return {
          ok: false,
          reason: `payment_intent_${intent.status}`,
          decline: {
            errorCode: lastErr?.code ?? `payment_intent_${intent.status}`,
            declineCode: lastErr?.decline_code ?? null,
            message: lastErr?.message ?? `Payment intent ${intent.status}`,
            paymentIntentId: intent.id,
          },
        };
      }
      return { ok: true, chargeId: intent.id };
    }

    // Overage: queue an invoice item on the active subscription customer.
    const item = await stripe.invoiceItems.create({
      customer: opts.stripeCustomerId,
      amount: opts.amountCents,
      currency: "usd",
      description: opts.description,
      metadata,
    });
    return { ok: true, chargeId: item.id };
  } catch (err: any) {
    // Stripe surfaces card failures as exceptions on off-session confirms.
    // err.code / err.decline_code mirror the PaymentIntent.last_payment_error
    // fields, and err.payment_intent.id lets us cross-reference in the dash.
    const code = err?.code ?? err?.raw?.code ?? null;
    const declineCode = err?.decline_code ?? err?.raw?.decline_code ?? null;
    const piId = err?.payment_intent?.id ?? err?.raw?.payment_intent?.id ?? null;
    const message = err?.message ?? "Stripe error";
    console.error(
      `[Metering] Failed to record ${opts.source} charge for user ${opts.userId}: ${message} (code=${code} decline=${declineCode})`,
    );
    return {
      ok: false,
      reason: message,
      decline: {
        errorCode: code,
        declineCode,
        message,
        paymentIntentId: piId,
      },
    };
  }
}
