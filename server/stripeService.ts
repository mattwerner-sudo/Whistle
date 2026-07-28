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
    seats: number,
    successUrl: string,
    cancelUrl: string,
    userId: number
  ) {
    const stripe = await getUncachableStripeClient();
    const lookupKey = 'whistle_standard_monthly';

    // Prefer the pre-created $25/seat price (by lookup key); fall back to
    // inline price_data for environments that haven't seeded products yet.
    let lineItem: any = null;
    try {
      const prices = await stripe.prices.list({ lookup_keys: [lookupKey] });
      if (prices.data.length > 0) {
        lineItem = { price: prices.data[0].id, quantity: seats };
      }
    } catch {
      // fall through to price_data
    }
    if (!lineItem) {
      console.log(`Lookup key ${lookupKey} not found, using fallback price_data`);
      lineItem = {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Whistle',
            description: 'Full access to Whistle. $25 per seat per month.',
          },
          unit_amount: 2500,
          recurring: { interval: 'month' },
        },
        quantity: seats,
      };
    }

    // Let the buyer adjust the seat count on the Stripe checkout page too.
    lineItem.adjustable_quantity = { enabled: true, minimum: 1, maximum: 100 };

    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [lineItem],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: String(userId),
        planId: 'standard',
        seats: String(seats),
        type: 'subscription',
      },
      subscription_data: {
        metadata: {
          userId: String(userId),
          planId: 'standard',
        },
      },
    });
  }

  // Change the seat quantity on an existing subscription (prorated).
  async updateSubscriptionSeats(subscriptionId: string, seats: number) {
    const stripe = await getUncachableStripeClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const itemId = subscription.items.data[0]?.id;
    if (!itemId) throw new Error('Subscription has no line items');
    return await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: itemId, quantity: seats }],
      proration_behavior: 'create_prorations',
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
    seats?: number;
  }) {
    const [user] = await db.update(users).set(stripeInfo).where(eq(users.id, userId)).returning();
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

    const existing = await stripe.prices.list({ lookup_keys: ['whistle_standard_monthly'] });
    if (existing.data.length > 0) {
      console.log('Standard price already exists, skipping seed');
      return { created: false, priceId: existing.data[0].id };
    }

    const product = await stripe.products.create({
      name: 'Whistle',
      description: 'Full access to Whistle. $25 per seat per month.',
      metadata: { tier: 'standard' },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 2500,
      currency: 'usd',
      recurring: { interval: 'month' },
      lookup_key: 'whistle_standard_monthly',
      metadata: { tier: 'standard' },
    });

    console.log('Created Whistle standard product ($25/seat/month)');
    return { created: true, productId: product.id, priceId: price.id };
  }
}

export const stripeService = new StripeService();
