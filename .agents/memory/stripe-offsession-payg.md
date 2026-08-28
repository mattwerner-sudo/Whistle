---
name: Stripe off-session PAYG charges
description: Why PAYG per-reveal charges must name a payment method explicitly, and the webhook-secret gotcha.
---

# PAYG off-session charging

Off-session PaymentIntents for Pay-As-You-Go reveals must pass an **explicit
`payment_method`**. Creating a PaymentIntent with only `customer` +
`off_session` + `automatic_payment_methods` relies on the customer's
`invoice_settings.default_payment_method`, which Stripe Checkout in `setup`
mode does **not** set automatically. Result: a user saves a valid card, then
the first reveal charge fails with "no payment method."

**How to apply:** any off-session charge against a saved card must resolve and
pass the payment method explicitly (default first, most-recent card as fallback),
never depend on an unset customer default. Setting the customer default at
setup-completion is good hygiene but is not sufficient on its own — the explicit
resolve-at-charge-time fallback is the real guarantee, since the webhook that
sets the default may not run (see below).

## Related landmine: webhook secret
`stripe-replit-sync` exposes only `processWebhook(payload, signature)` — there is
**no `getWebhookSecret()` method**, and it returns `void` (not the event). It
verifies the signature internally (throws on a bad one) and runs its own sync.

To run custom handlers on top: call `await sync.processWebhook(payload, sig)`
first, then — since the payload is now authenticated — `JSON.parse(payload)` to
get the event. Do NOT try to re-verify with a secret-fetching method that
doesn't exist. Always verify webhook-driven flows actually execute (watch the
logs for "is not a function") before assuming a DB/Stripe side effect happened.
