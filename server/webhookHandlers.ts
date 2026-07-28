import type Stripe from 'stripe';
import { getStripeSync } from './stripeClient';
import { db } from './db';
import { users, usageEvents } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { syncEntitlementFromUser } from './lib/entitlements';

const PLAN_TIER = 'standard';

function extractSeats(subscription: any): number {
  const qty = subscription?.items?.data?.[0]?.quantity;
  return Number.isInteger(qty) && qty > 0 ? qty : 1;
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    // processWebhook verifies the Stripe signature internally (it calls
    // constructEventAsync and throws on a bad signature) and runs the library's
    // own data sync. It returns void and stripe-replit-sync exposes no
    // getWebhookSecret(), so once this resolves the payload is authenticated and
    // we can safely parse it to drive our own custom handlers below.
    await sync.processWebhook(payload, signature);

    const event = JSON.parse(payload.toString('utf8')) as Stripe.Event;

    console.log(`[Stripe Webhook] Received event: ${event.type}`);

    // Telemetry: log every webhook to usage_events for funnel analysis.
    try {
      await db.insert(usageEvents).values({
        eventType: `stripe_webhook:${event.type}`,
        details: { eventId: event.id, livemode: event.livemode },
      });
    } catch (logErr: any) {
      console.error('[Stripe Webhook] usage_events log failed:', logErr?.message || logErr);
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as any;
          const userId = session.metadata?.userId;
          const customerId = session.customer as string;
          const subscriptionId = session.subscription as string;

          if (userId && subscriptionId) {
            console.log(`[Stripe] Checkout completed for user ${userId}, subscription ${subscriptionId}`);
            const seats = parseInt(session.metadata?.seats) || 1;
            await db.update(users).set({
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              subscriptionStatus: 'active',
              subscriptionTier: PLAN_TIER,
              seats,
              currentPeriodStart: new Date(),
            }).where(eq(users.id, parseInt(userId)));
            await syncEntitlementFromUser(parseInt(userId));
            console.log(`[Stripe] Activated subscription for user ${userId} (${seats} seat${seats === 1 ? '' : 's'})`);
          }
          break;
        }

        case 'customer.subscription.updated':
        case 'customer.subscription.created': {
          const subscription = event.data.object as any;
          const customerId = subscription.customer as string;
          const status = subscription.status;
          const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
          const currentPeriodStart = new Date(subscription.current_period_start * 1000);
          const priceId = subscription.items?.data?.[0]?.price?.id;
          const seats = extractSeats(subscription);

          const [user] = await db.select().from(users)
            .where(eq(users.stripeCustomerId, customerId)).limit(1);

          if (user) {
            console.log(`[Stripe] Subscription ${status} for user ${user.id}, seats: ${seats}`);
            await db.update(users).set({
              stripeSubscriptionId: subscription.id,
              subscriptionStatus: status === 'active' ? 'active' : status === 'past_due' ? 'past_due' : 'inactive',
              subscriptionTier: PLAN_TIER,
              seats,
              priceId: priceId || user.priceId,
              currentPeriodEnd,
              currentPeriodStart,
            }).where(eq(users.id, user.id));
            await syncEntitlementFromUser(user.id);
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as any;
          const customerId = subscription.customer as string;

          const [user] = await db.select().from(users)
            .where(eq(users.stripeCustomerId, customerId)).limit(1);

          if (user) {
            console.log(`[Stripe] Subscription canceled for user ${user.id}`);
            await db.update(users).set({
              subscriptionStatus: 'canceled',
            }).where(eq(users.id, user.id));
            await syncEntitlementFromUser(user.id);
          }
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          const customerId = invoice.customer as string;
          const subscriptionId = invoice.subscription as string;
          const billingReason = invoice.billing_reason;

          if (subscriptionId) {
            const [user] = await db.select().from(users)
              .where(eq(users.stripeCustomerId, customerId)).limit(1);

            if (user) {
              console.log(`[Stripe] Payment succeeded for user ${user.id}, reason: ${billingReason}`);

              const updateData: any = { subscriptionStatus: 'active' };
              if (billingReason === 'subscription_cycle') {
                updateData.currentPeriodStart = new Date();
              }

              const subResult = await db.execute(
                sql`SELECT current_period_end FROM stripe.subscriptions WHERE id = ${subscriptionId}`
              );
              const sub = subResult.rows[0] as any;
              if (sub?.current_period_end) {
                updateData.currentPeriodEnd = new Date(sub.current_period_end * 1000);
              }

              await db.update(users).set(updateData).where(eq(users.id, user.id));
              await syncEntitlementFromUser(user.id);
            }
          }
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as any;
          const customerId = invoice.customer as string;

          const [user] = await db.select().from(users)
            .where(eq(users.stripeCustomerId, customerId)).limit(1);

          if (user) {
            console.log(`[Stripe] Payment failed for user ${user.id}`);
            await db.update(users).set({
              subscriptionStatus: 'past_due',
            }).where(eq(users.id, user.id));
            await syncEntitlementFromUser(user.id);
          }
          break;
        }
      }
    } catch (error: any) {
      console.error(`[Stripe Webhook] Error handling ${event.type}:`, error.message);
    }
  }
}
