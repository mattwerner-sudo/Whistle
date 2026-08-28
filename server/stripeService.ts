import { db } from './db';
import { users } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { getUncachableStripeClient } from './stripeClient';

export class StripeService {
  async createCustomer(email: string, userId: number) {
    const stripe = await getUncachableStripeClient();
    return await stripe.customers.create({
      email,
      metadata: { userId: String(userId) },
    });
  }

  async createSubscriptionCheckoutSession(
    customerId: string,
    planId: string,
    plan: { name: string; credits: number; overageRate: number; tier: string; annualPrice: number },
    lookupKey: string,
    interval: 'month' | 'year',
    successUrl: string,
    cancelUrl: string,
    userId: number,
    trialPeriodDays?: number,
  ) {
    const stripe = await getUncachableStripeClient();
    
    // Try to find price by lookup_key first (if prices exist in Stripe Dashboard)
    // Falls back to creating price_data if lookup_key not found
    let lineItems: any[];
    const fallbackPrice = plan.annualPrice;
    
    try {
      const prices = await stripe.prices.list({
        lookup_keys: [lookupKey],
        expand: ['data.product'],
      });
      
      if (prices.data.length > 0) {
        // Use pre-created price from Stripe Dashboard
        lineItems = [{
          price: prices.data[0].id,
          quantity: 1,
        }];
        console.log(`Using Stripe price with lookup_key: ${lookupKey}`);
      } else {
        // Fallback: create price_data on-the-fly (for development/testing)
        console.log(`Lookup key ${lookupKey} not found, using fallback price_data`);
        lineItems = [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Whistle ${plan.name} Plan`,
              description: `${plan.credits} credits/month with ${plan.tier} tier benefits`,
            },
            unit_amount: fallbackPrice,
            recurring: { interval },
          },
          quantity: 1,
        }];
      }
    } catch (error) {
      // If lookup fails, use price_data fallback
      console.log(`Lookup key search failed, using fallback price_data`);
      lineItems = [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Whistle ${plan.name} Plan`,
            description: `${plan.credits} credits/month with ${plan.tier} tier benefits`,
          },
          unit_amount: fallbackPrice,
          recurring: { interval },
        },
        quantity: 1,
      }];
    }

    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { 
        userId: String(userId),
        planId,
        tier: plan.tier,
        credits: String(plan.credits),
        overageRate: String(plan.overageRate),
        type: 'subscription',
      },
      subscription_data: {
        metadata: {
          userId: String(userId),
          planId,
          tier: plan.tier,
          credits: String(plan.credits),
          overageRate: String(plan.overageRate),
        },
        ...(trialPeriodDays ? { trial_period_days: trialPeriodDays } : {}),
      },
    });
  }

  async createCreditCheckoutSession(
    customerId: string,
    packageId: string,
    creditPackage: { credits: number; price: number; name: string },
    successUrl: string,
    cancelUrl: string,
    userId: number
  ) {
    const stripe = await getUncachableStripeClient();
    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: creditPackage.name,
            description: `${creditPackage.credits} credits for Whistle`,
          },
          unit_amount: creditPackage.price,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { 
        userId: String(userId),
        packageId,
        credits: String(creditPackage.credits),
        type: 'credit_purchase',
      },
    });
  }

  async createPaygSetupCheckoutSession(
    customerId: string,
    successUrl: string,
    cancelUrl: string,
    userId: number
  ) {
    const stripe = await getUncachableStripeClient();
    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'setup',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: String(userId),
        type: 'payg_setup',
        tier: 'payg',
      },
    });
  }

  async createCustomerPortalSession(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  async getProduct(productId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE id = ${productId}`
    );
    return result.rows[0] || null;
  }

  async listProducts(active = true, limit = 20, offset = 0) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE active = ${active} LIMIT ${limit} OFFSET ${offset}`
    );
    return result.rows;
  }

  async listProductsWithPrices(active = true, limit = 20, offset = 0) {
    const result = await db.execute(
      sql`
        WITH paginated_products AS (
          SELECT id, name, description, metadata, active
          FROM stripe.products
          WHERE active = ${active}
          ORDER BY id
          LIMIT ${limit} OFFSET ${offset}
        )
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.active as product_active,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.active as price_active,
          pr.metadata as price_metadata
        FROM paginated_products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        ORDER BY p.id, pr.unit_amount
      `
    );
    return result.rows;
  }

  async getPrice(priceId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE id = ${priceId}`
    );
    return result.rows[0] || null;
  }

  async listPrices(active = true, limit = 20, offset = 0) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE active = ${active} LIMIT ${limit} OFFSET ${offset}`
    );
    return result.rows;
  }

  async getSubscription(subscriptionId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.subscriptions WHERE id = ${subscriptionId}`
    );
    return result.rows[0] || null;
  }

  async updateUserStripeInfo(userId: number, stripeInfo: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    subscriptionStatus?: string;
    subscriptionTier?: string;
    priceId?: string;
    currentPeriodEnd?: Date;
    currentPeriodStart?: Date;
    monthlyCreditsAllocation?: number;
    creditsUsedThisPeriod?: number;
    overageRate?: number;
  }) {
    const [user] = await db.update(users).set(stripeInfo).where(eq(users.id, userId)).returning();
    return user;
  }

  async addCreditsToUser(userId: number, credits: number) {
    const [user] = await db.update(users)
      .set({ 
        creditsBalance: sql`${users.creditsBalance} + ${credits}` 
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async resetPeriodUsage(userId: number, newCredits: number) {
    const [user] = await db.update(users)
      .set({ 
        creditsBalance: sql`${users.creditsBalance} + ${newCredits}`,
        creditsUsedThisPeriod: 0,
        currentPeriodStart: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getUserById(userId: number) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return user;
  }

  async getUserByStripeCustomerId(customerId: string) {
    const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId)).limit(1);
    return user;
  }

  async seedSubscriptionProducts() {
    const stripe = await getUncachableStripeClient();
    
    const existingProducts = await stripe.products.list({ limit: 10 });
    if (existingProducts.data.length > 0) {
      console.log('Products already exist, skipping seed');
      return { created: false, products: existingProducts.data };
    }

    // Pro: $100/mo, 150 reveals + $0.50 overage
    const proProduct = await stripe.products.create({
      name: 'Whistle Pro',
      description: '150 reveals/month + $0.50 per overage reveal',
      metadata: { tier: 'pro', credits: '150', overageRate: '50' }
    });

    // Team: $400/mo, 800 reveals + $0.40 overage
    const teamProduct = await stripe.products.create({
      name: 'Whistle Team',
      description: '800 reveals/month + $0.40 per overage reveal',
      metadata: { tier: 'team', credits: '800', overageRate: '40' }
    });

    await stripe.prices.create({
      product: proProduct.id,
      unit_amount: 10000,
      currency: 'usd',
      recurring: { interval: 'month' },
      lookup_key: 'whistle_pro_monthly',
      metadata: { tier: 'pro', credits: '150', overageRate: '50' }
    });

    await stripe.prices.create({
      product: teamProduct.id,
      unit_amount: 40000,
      currency: 'usd',
      recurring: { interval: 'month' },
      lookup_key: 'whistle_team_monthly',
      metadata: { tier: 'team', credits: '800', overageRate: '40' }
    });

    console.log(`Created products: Pro ($100/mo, 150 reveals), Team ($400/mo, 800 reveals)`);

    return { created: true, products: [proProduct, teamProduct] };
  }
}

export const stripeService = new StripeService();
