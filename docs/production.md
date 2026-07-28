# Whistle — Production Launch & Stripe Live Mode Runbook

This is the operator's checklist for taking Whistle from the development repl
to a live production deployment with real-money Stripe billing. Treat each
step as a checklist item; don't skip the smoke tests at the end.

## 0. How Stripe credentials work in this repo

Whistle does **not** read `STRIPE_SECRET_KEY` / `VITE_STRIPE_PUBLIC_KEY`
from `process.env`. The Stripe SDK is configured via Replit's managed
Stripe integration in `server/stripeClient.ts`:

- `getCredentials()` calls the Replit connectors API and, based on
  `REPLIT_DEPLOYMENT`, asks for the `development` or `production`
  Stripe connection.
- The publishable + secret keys for each environment are stored on the
  corresponding Replit connection, **not** as env vars.
- The webhook signing secret is owned by `stripe-replit-sync` and
  retrieved through `sync.getWebhookSecret()`. `server/index.ts` calls
  `findOrCreateManagedWebhook` on boot, so once the production connection
  exists the webhook is auto-provisioned.

The practical implication for going live: you don't paste `sk_live_...`
into Secrets — you connect a live Stripe account to the **production**
environment of the integration.

## 1. Publish the app

1. In the Replit workspace, open the Publishing tool.
2. Confirm the deployment config in `.replit`:
   - `deploymentTarget = "autoscale"`
   - `build = ["npm", "run", "build"]`
   - `run = ["npm", "run", "start"]`
3. Click **Publish**. Pick your geography (this is permanent — see
   `.local/skills/deployment/SKILL.md` for the supported regions).
4. After the build finishes, hit the production URL and confirm:
   - `GET /health` returns `{"status":"ok"}`
   - `GET /api/billing/account` responds (200 or 401 — anything but 5xx)
   - The landing page loads at `/`.

## 2. Connect live Stripe to the production environment

1. Open the Stripe integration in the Replit workspace.
2. Switch to the **Production** environment slot and connect a Stripe
   account that is in **live mode** (toggle off "View test data" in the
   Stripe dashboard before authorizing).
3. Keep the existing development connection on a test-mode account.
   Dev and prod should never share keys.
4. Restart the production deployment so `getCredentials()` picks up the
   new connection. Watch the deploy logs for:
   - `Stripe schema ready`
   - `Webhook configured: https://<prod-domain>/api/stripe/webhook`
     (or `... no URL returned ...` if a managed webhook already exists)
   - `Stripe data synced`

## 3. Seed live products

The seed endpoint is idempotent — it short-circuits if any products
already exist on the connected account. Run it once against production:

```bash
curl -X POST "https://<prod-domain>/api/stripe/seed-products" \
  -H "X-Admin-Secret: $ADMIN_SECRET_PROD"
```

`ADMIN_SECRET` must be set in the production Secrets to a strong value.
The server refuses to start without it, so set it in dev and prod Secrets
before booting. Verify in the Stripe dashboard:

- Product **Whistle Pro** with price `whistle_pro_monthly` = $100/mo.
- Product **Whistle Team** with price `whistle_team_monthly` = $400/mo.

## 4. Webhook

The managed webhook should already exist (see step 2 logs). If you need
to recreate it manually:

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**.
2. URL: `https://<prod-domain>/api/billing/webhook` (also accepts
   `/api/stripe/webhook` — they share the same handler in `server/index.ts`).
3. Events to subscribe to (must cover both checkout & metering paths):
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
4. Reveal the signing secret and store it where the managed sync expects
   it (the `stripe-replit-sync` table — the library handles this when the
   webhook is created through `findOrCreateManagedWebhook`). If you
   created the endpoint manually, run the seed endpoint again to force a
   resync, or restart the deployment.

## 5. Production secrets checklist

Set these in the **production** Secrets pane (separate from dev):

| Secret | Purpose |
| --- | --- |
| `SESSION_SECRET` | Long random string. Required in every environment — the server refuses to start without it. |
| `ADMIN_SECRET` | Strong unique value; gates `/api/stripe/seed-products` and admin routes. |
| `GEMINI_API_KEY` | Real Gemini key (dev runs in mock mode). |
| `SENDGRID_API_KEY` | Required for verification + payment-decline emails. |
| `MAIL_FROM` | Verified sender for SendGrid. |
| `APP_URL` | `https://<prod-domain>` — used in email links. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | If Google sign-in is enabled. |

The Stripe keys are **not** in this table on purpose — they come from
the managed connection (see §0).

## 6. Smoke tests (use real money — refund after)

Use a private window for each so sessions don't leak.

**6a. Subscription**
1. Register a fresh user.
2. `/pricing` → Subscribe to Pro with a real card.
3. After redirect back, confirm in the prod DB that the user row has
   `subscription_tier = 'pro'` and `monthly_credits_allocation = 150`.
4. Open the customer portal from `/settings/billing`, cancel the
   subscription, and confirm tier reverts to `free` after the webhook
   processes.
5. Refund the charge from the Stripe dashboard.

**6b. PAYG**
1. Register another fresh user (free tier).
2. `/pricing` → "Pay as you go" to attach a card via setup mode.
3. Burn through the free reveals on `/staff`, then trigger one more
   reveal. Confirm:
   - The reveal succeeds.
   - A `payment_intents` charge of $0.90 appears in Stripe.
   - The user receives the email receipt (Stripe sends this).
4. Refund the $0.90 charge.

**6c. Decline**
1. In test mode (dev environment) verify with card `4000 0000 0000 0341`
   that the `PaymentFailureDialog` opens and the decline email lands.
   In live, you can't safely force a real decline — rely on the test-mode
   verification plus the row in `payment_failures` from step 6b's
   pre-attach attempts.

## 7. Rollback to test mode

If something goes sideways during launch:

1. **Stop accepting new charges:** in the Stripe dashboard, archive the
   Pro and Team prices (this hides the Subscribe buttons from working).
2. **Disconnect live Stripe** from the Replit production integration and
   reconnect the test-mode account. Restart the deployment.
3. **Refund any real charges** from the Stripe dashboard
   (Payments → ... → Refund).
4. **Disable or delete the live webhook** to stop event delivery.
5. **Reset affected users:** `UPDATE users SET subscription_tier='free',
   subscription_status='inactive', stripe_subscription_id=NULL WHERE id
   IN (...);` for anyone who got into a half-state.
6. The dev environment is unaffected — it has its own connection.

## 8. Routine operations

- **Rotate the webhook secret:** Stripe Dashboard → Webhooks → Roll
  secret. The `stripe-replit-sync` table stores the active secret; the
  easiest re-sync is to call `findOrCreateManagedWebhook` by restarting
  the deployment (it picks up the new secret on boot).
- **Re-seed products** (e.g. after a Stripe account migration):
  archive existing products in Stripe first, then re-run the seed
  endpoint. It refuses to run while any products exist.
- **Production logs:** use `fetchDeploymentLogs` (see
  `.local/skills/deployment/references/deployment-logs.md`) — do not
  curl the dev `REPLIT_DOMAINS` URL expecting prod data.
