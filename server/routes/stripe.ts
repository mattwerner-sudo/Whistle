import { Router, Request, Response } from "express";
import { z } from "zod";
import { stripeService } from "../stripeService";
import { db } from "../db";
import { usageEvents } from "@shared/schema";

const SUBSCRIPTION_PLANS: Record<string, {
  name: string;
  annualPrice: number;
  credits: number;
  overageRate: number;
  seats: number;
  tier: string;
  lookupKey: string;
}> = {
  'plan_pro': {
    name: 'Pro',
    annualPrice: 240000,  // $2,400/yr
    credits: 2400,
    overageRate: 50,      // $0.50/reveal
    seats: 1,
    tier: 'pro',
    lookupKey: 'whistle_pro_annual',
  },
  'plan_team': {
    name: 'Team',
    annualPrice: 720000,  // $7,200/yr
    credits: 9600,
    overageRate: 35,      // $0.35/reveal
    seats: 5,
    tier: 'team',
    lookupKey: 'whistle_team_annual',
  },
  'plan_enterprise': {
    name: 'Enterprise',
    annualPrice: 1800000, // $18,000/yr
    credits: 36000,
    overageRate: 25,      // $0.25/reveal
    seats: -1,
    tier: 'enterprise',
    lookupKey: 'whistle_enterprise_annual',
  },
};

// Prepaid credit packs — self-serve, one-time, no subscription. Priced at
// Whistle's premium ($0.40–0.60/reveal), NOT commodity-enrichment rates, so
// packs feed the funnel without undercutting the annual plans.
const CREDIT_PACKS: Record<string, { name: string; credits: number; price: number }> = {
  'pack_500':  { name: 'Whistle 500 Reveals',   credits: 500,   price: 30000 },  // $300  ($0.60)
  'pack_1500': { name: 'Whistle 1,500 Reveals', credits: 1500,  price: 75000 },  // $750  ($0.50)
  'pack_5000': { name: 'Whistle 5,000 Reveals', credits: 5000,  price: 200000 }, // $2,000 ($0.40)
};

const TRIAL_PERIOD_DAYS = 14;

const checkoutSchema = z.object({
  type: z.enum(['subscription', 'credits']),
  planId: z.string().optional(),
  packId: z.string().optional(),
});

const router = Router();

router.post("/checkout", async (req: Request, res: Response) => {
  try {
    if (!req.session?.userId) {
      return res.json({ url: null, message: "No active session. Checkout not available in open-access mode." });
    }

    const validation = checkoutSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.flatten().fieldErrors 
      });
    }

    const { type, planId } = validation.data;
    const user = await stripeService.getUserById(req.session.userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeService.createCustomer(user.email, user.id);
      await stripeService.updateUserStripeInfo(user.id, { stripeCustomerId: customer.id });
      customerId = customer.id;
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    if (type === 'subscription') {
      // Accept either the internal key ('plan_pro') or the Stripe lookup key
      // ('whistle_pro_annual') the client actually sends.
      const plan = planId
        ? (SUBSCRIPTION_PLANS[planId] ??
           Object.values(SUBSCRIPTION_PLANS).find((p) => p.lookupKey === planId))
        : undefined;
      if (!plan) {
        return res.status(400).json({ error: "Invalid subscription plan" });
      }

      const session = await stripeService.createSubscriptionCheckoutSession(
        customerId,
        planId ?? plan.tier,
        plan,
        plan.lookupKey,
        'year',
        `${baseUrl}/pricing?success=true&session_id={CHECKOUT_SESSION_ID}`,
        `${baseUrl}/pricing?canceled=true`,
        user.id,
        TRIAL_PERIOD_DAYS,
      );

      await db.insert(usageEvents).values({
        eventType: "stripe_checkout_created",
        sessionId: req.sessionID || null,
        details: { userId: user.id, type: "subscription", planId, interval: "year", sessionStripeId: session.id },
      });

      return res.json({ url: session.url });
    }

    if (type === 'credits') {
      const { packId } = validation.data;
      if (!packId || !CREDIT_PACKS[packId]) {
        return res.status(400).json({ error: "Invalid credit pack" });
      }
      const pack = CREDIT_PACKS[packId];

      const session = await stripeService.createCreditCheckoutSession(
        customerId,
        packId,
        pack,
        `${baseUrl}/pricing?success=true&session_id={CHECKOUT_SESSION_ID}`,
        `${baseUrl}/pricing?canceled=true`,
        user.id,
      );

      await db.insert(usageEvents).values({
        eventType: "stripe_checkout_created",
        sessionId: req.sessionID || null,
        details: { userId: user.id, type: "credits", packId, credits: pack.credits, sessionStripeId: session.id },
      });

      return res.json({ url: session.url });
    }

    return res.status(400).json({ error: "Invalid checkout type" });
  } catch (error: any) {
    console.error("Checkout error:", error);
    res.status(500).json({ error: error.message || "Failed to create checkout session" });
  }
});

router.post("/portal", async (req: Request, res: Response) => {
  try {
    if (!req.session?.userId) {
      return res.json({ url: null, message: "No active session. Portal not available in open-access mode." });
    }

    const user = await stripeService.getUserById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: "No billing account found" });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const session = await stripeService.createCustomerPortalSession(
      user.stripeCustomerId,
      `${baseUrl}/pricing`
    );

    res.json({ url: session.url });
  } catch (error: any) {
    console.error("Portal error:", error);
    res.status(500).json({ error: error.message || "Failed to create portal session" });
  }
});

router.get("/products", async (_req: Request, res: Response) => {
  try {
    const products = await stripeService.listProductsWithPrices();
    
    const productsMap = new Map<string, any>();
    for (const row of products as any[]) {
      if (!productsMap.has(row.product_id)) {
        productsMap.set(row.product_id, {
          id: row.product_id,
          name: row.product_name,
          description: row.product_description,
          active: row.product_active,
          metadata: row.product_metadata,
          prices: []
        });
      }
      if (row.price_id) {
        productsMap.get(row.product_id).prices.push({
          id: row.price_id,
          unit_amount: row.unit_amount,
          currency: row.currency,
          recurring: row.recurring,
          active: row.price_active,
          metadata: row.price_metadata,
        });
      }
    }

    res.json({ data: Array.from(productsMap.values()) });
  } catch (error: any) {
    console.error("Products error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch products" });
  }
});

router.get("/subscription", async (req: Request, res: Response) => {
  try {
    if (!req.session?.userId) {
      return res.json({ subscription: null, status: 'inactive', tier: 'payg' });
    }

    const user = await stripeService.getUserById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.stripeSubscriptionId) {
      return res.json({ 
        subscription: null, 
        status: user.subscriptionStatus || 'inactive',
        tier: user.subscriptionTier || 'payg'
      });
    }

    const subscription = await stripeService.getSubscription(user.stripeSubscriptionId);
    res.json({ 
      subscription, 
      status: user.subscriptionStatus,
      tier: user.subscriptionTier,
      currentPeriodEnd: user.currentPeriodEnd,
      monthlyCreditsAllocation: user.monthlyCreditsAllocation,
      creditsUsedThisPeriod: user.creditsUsedThisPeriod
    });
  } catch (error: any) {
    console.error("Subscription error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch subscription" });
  }
});

router.get("/publishable-key", async (_req: Request, res: Response) => {
  try {
    const { getStripePublishableKey } = await import("../stripeClient");
    const key = await getStripePublishableKey();
    res.json({ publishableKey: key });
  } catch (error: any) {
    console.error("Publishable key error:", error);
    res.status(500).json({ error: error.message || "Failed to get publishable key" });
  }
});

router.post("/seed-products", async (req: Request, res: Response) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const providedSecret = req.headers['x-admin-secret'] as string;
    if (!adminSecret || !providedSecret || adminSecret !== providedSecret) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const result = await stripeService.seedSubscriptionProducts();
    
    const { getStripeSync } = await import("../stripeClient");
    const stripeSync = await getStripeSync();
    await stripeSync.syncBackfill();

    res.json(result);
  } catch (error: any) {
    console.error("Seed products error:", error);
    res.status(500).json({ error: error.message || "Failed to seed products" });
  }
});

export const SUBSCRIPTION_PLAN_CONFIG = SUBSCRIPTION_PLANS;
export const CREDIT_PACK_CONFIG = CREDIT_PACKS;

export default router;
