import type Stripe from 'stripe';
import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { db } from './db';
import { users, creditTransactions, usageEvents, organizations } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { syncEntitlementFromUser } from './lib/entitlements';
import { applyCreditPurchase } from './lib/credit-grants';

const TIER_CONFIG: Record<string, { credits: number; overageRate: number; seats: number }> = {
  'pro':        { credits: 2400,  overageRate: 50, seats: 1  },
  'team':       { credits: 9600,  overageRate: 35, seats: 5  },
  'enterprise': { credits: 36000, overageRate: 25, seats: -1 },
};

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

    const stripe = await getUncachableStripeClient();
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
          const purchaseType = session.metadata?.type;
          const credits = session.metadata?.credits;
          const tier = session.metadata?.tier;
          const paymentIntentId = session.payment_intent as string;

          if (userId) {
            console.log(`[Stripe] Checkout completed for user ${userId}, type: ${purchaseType}`);
            
            if (purchaseType === 'payg_setup') {
              const setupIntentId = session.setup_intent as string | undefined;
              // Save the collected card as the customer's default so off-session
              // reveal charges have a card to bill. Without this the first PAYG
              // reveal fails even though a valid card was just entered.
              if (setupIntentId && customerId) {
                try {
                  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
                  const pm = setupIntent.payment_method;
                  const pmId = pm ? (typeof pm === 'string' ? pm : pm.id) : null;
                  if (pmId) {
                    await stripe.customers.update(customerId, {
                      invoice_settings: { default_payment_method: pmId },
                    });
                    console.log(`[Stripe] Set default payment method ${pmId} for customer ${customerId}`);
                  } else {
                    console.error(`[Stripe] PAYG setup ${setupIntentId} completed with no payment method`);
                  }
                } catch (pmErr: any) {
                  console.error(`[Stripe] Failed to set default payment method for ${customerId}:`, pmErr?.message || pmErr);
                }
              }
              await db.update(users).set({
                stripeCustomerId: customerId,
                subscriptionTier: 'payg',
                subscriptionStatus: 'active',
              }).where(eq(users.id, parseInt(userId)));
              await syncEntitlementFromUser(parseInt(userId));
              console.log(`[Stripe] PAYG card-on-file activated for user ${userId} (setupIntent=${setupIntentId})`);
            } else if (purchaseType === 'credit_purchase' && credits) {
              const creditsAmount = parseInt(credits);
              if (!Number.isFinite(creditsAmount) || creditsAmount <= 0) {
                console.error(`[Stripe] Ignoring credit purchase with invalid credits metadata "${credits}" for user ${userId}`);
                break;
              }
              // Key idempotency on the payment intent; fall back to the checkout
              // session id (always present) if Stripe omits the intent. This
              // makes a duplicate webhook delivery a no-op instead of double-credit.
              const idempotencyKey = paymentIntentId || (session.id as string);

              const { granted } = await applyCreditPurchase({
                userId: parseInt(userId),
                creditsAmount,
                idempotencyKey,
                customerId,
              });

              if (granted) {
                console.log(`[Stripe] Added ${creditsAmount} credits to user ${userId}`);
              } else {
                console.log(`[Stripe] Duplicate credit purchase ignored for user ${userId} (key=${idempotencyKey})`);
              }
            } else if (purchaseType === 'subscription' && subscriptionId && tier) {
              const tierConfig = TIER_CONFIG[tier];
              if (!tierConfig) {
                console.error(`[Stripe] Unknown subscription tier on checkout: ${tier}`);
                break;
              }

              const uid = parseInt(userId);
              await db.update(users).set({
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                subscriptionStatus: 'active',
                subscriptionTier: tier,
                monthlyCreditsAllocation: tierConfig.credits,
                overageRate: tierConfig.overageRate,
                creditsUsedThisPeriod: 0,
                currentPeriodStart: new Date(),
              }).where(eq(users.id, uid));
              await syncEntitlementFromUser(uid);

              // Update the org seat limit to match the new plan.
              const [activatedUser] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, uid)).limit(1);
              if (activatedUser?.organizationId) {
                await db.update(organizations).set({ seatLimit: tierConfig.seats }).where(eq(organizations.id, activatedUser.organizationId));
              }

              await db.insert(creditTransactions).values({
                userId: parseInt(userId),
                amount: tierConfig.credits,
                reason: 'subscription_start',
                stripePaymentIntentId: paymentIntentId,
              });

              console.log(`[Stripe] Activated ${tier} subscription for user ${userId} with ${tierConfig.credits} credits`);
            } else if (subscriptionId) {
              await db.update(users).set({
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                subscriptionStatus: 'active',
              }).where(eq(users.id, parseInt(userId)));
              await syncEntitlementFromUser(parseInt(userId));
            }
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
          const priceMetadata = subscription.items?.data?.[0]?.price?.metadata;
          const productMetadata = subscription.items?.data?.[0]?.price?.product?.metadata;
          const tier = subscription.metadata?.tier || priceMetadata?.tier || productMetadata?.tier;

          const [user] = await db.select().from(users)
            .where(eq(users.stripeCustomerId, customerId)).limit(1);

          if (user) {
            console.log(`[Stripe] Subscription ${status} for user ${user.id}, tier: ${tier || user.subscriptionTier}`);
            
            const effectiveTier = tier || user.subscriptionTier;
            
            const updateData: any = {
              stripeSubscriptionId: subscription.id,
              subscriptionStatus: status === 'active' ? 'active' : status === 'past_due' ? 'past_due' : 'inactive',
              priceId: priceId || user.priceId,
              currentPeriodEnd,
              currentPeriodStart,
            };

            if (effectiveTier && TIER_CONFIG[effectiveTier]) {
              updateData.subscriptionTier = effectiveTier;
              updateData.monthlyCreditsAllocation = TIER_CONFIG[effectiveTier].credits;
              updateData.overageRate = TIER_CONFIG[effectiveTier].overageRate;
              if (status === 'active' && user.subscriptionTier !== effectiveTier) {
                updateData.creditsUsedThisPeriod = 0;
              }
            }

            await db.update(users).set(updateData).where(eq(users.id, user.id));
            await syncEntitlementFromUser(user.id);

            // Keep org seat limit in sync when the tier changes.
            if (effectiveTier && TIER_CONFIG[effectiveTier] && user.organizationId) {
              await db.update(organizations)
                .set({ seatLimit: TIER_CONFIG[effectiveTier].seats })
                .where(eq(organizations.id, user.organizationId));
            }
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
              subscriptionTier: 'pro',
              monthlyCreditsAllocation: 0,
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
              
              if (billingReason === 'subscription_cycle' && user.subscriptionTier && TIER_CONFIG[user.subscriptionTier]) {
                const tierConfig = TIER_CONFIG[user.subscriptionTier];
                
                // Subscription renewal: reset the monthly allowance counter. We do NOT add to
                // creditsBalance because subscription reveals are gated by
                // monthlyCreditsAllocation/creditsUsedThisPeriod, not the PAYG balance.
                await db.update(users).set({
                  subscriptionStatus: 'active',
                  monthlyCreditsAllocation: tierConfig.credits,
                  overageRate: tierConfig.overageRate,
                  creditsUsedThisPeriod: 0,
                  currentPeriodStart: new Date(),
                }).where(eq(users.id, user.id));
              await syncEntitlementFromUser(user.id);

                await db.insert(creditTransactions).values({
                  userId: user.id,
                  amount: tierConfig.credits,
                  reason: 'subscription_renewal',
                });

                console.log(`[Stripe] Reset monthly allowance (${tierConfig.credits}) for user ${user.id}`);
              } else {
                const subResult = await db.execute(
                  sql`SELECT current_period_end FROM stripe.subscriptions WHERE id = ${subscriptionId}`
                );
                const sub = subResult.rows[0] as any;
                if (sub?.current_period_end) {
                  await db.update(users).set({
                    subscriptionStatus: 'active',
                    currentPeriodEnd: new Date(sub.current_period_end * 1000),
                  }).where(eq(users.id, user.id));
              await syncEntitlementFromUser(user.id);
                }
              }
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
