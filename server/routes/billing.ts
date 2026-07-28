import { Router, Request, Response } from "express";
import { db } from "../db";
import { contactReveals, usageEvents, users } from "@shared/schema";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import { requireUser, UserRequest } from "../middleware/require-user";
import { REVEAL_GRACE_DAYS } from "../lib/contact-masking";
import { stripeService } from "../stripeService";

const router = Router();

// Single-plan pricing: $25 per seat per month.
export const SINGLE_PLAN = {
  id: "standard",
  name: "Whistle",
  pricePerSeatCents: 2500,
  interval: "month" as const,
  lookupKey: "whistle_standard_monthly",
  description: "$25 per seat per month. Unlimited reveals.",
  maxSeats: 100,
} as const;

router.get("/plans", (_req: Request, res: Response) => {
  res.json({ plans: [SINGLE_PLAN] });
});

router.get("/account", requireUser, async (req: UserRequest, res: Response) => {
  const user = req.user!;
  const cutoff = new Date(Date.now() - REVEAL_GRACE_DAYS * 24 * 60 * 60 * 1000);

  const [revealCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contactReveals)
    .where(eq(contactReveals.userId, user.id));

  const [recentReveals] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contactReveals)
    .where(and(eq(contactReveals.userId, user.id), gte(contactReveals.revealedAt, cutoff)));

  // Read from entitlements (canonical) — fall back to users for legacy rows.
  const { getEntitlement, syncEntitlementFromUser } = await import("../lib/entitlements");
  let ent = await getEntitlement(user.id);
  if (!ent) {
    await syncEntitlementFromUser(user.id);
    ent = await getEntitlement(user.id);
  }
  const status = ent?.status ?? user.subscriptionStatus ?? "inactive";
  const seats = ent?.seats ?? user.seats ?? 1;
  const hasActiveSubscription = status === "active";

  res.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    },
    plan: {
      id: SINGLE_PLAN.id,
      name: SINGLE_PLAN.name,
      status,
      hasActiveSubscription,
      canOpenPortal: !!user.stripeCustomerId,
      seats,
      pricePerSeatCents: SINGLE_PLAN.pricePerSeatCents,
      monthlyTotalCents: hasActiveSubscription ? seats * SINGLE_PLAN.pricePerSeatCents : 0,
      currentPeriodStart: user.currentPeriodStart ?? null,
      currentPeriodEnd: user.currentPeriodEnd ?? null,
    },
    usage: {
      lifetimeReveals: revealCount?.count ?? 0,
      activeRevealsInGrace: recentReveals?.count ?? 0,
    },
  });
});

// Stripe checkout — spec-required alias under /api/billing.
// Delegates to the existing handler in server/routes/stripe.ts.
router.post("/checkout", async (req: Request, res: Response, next) => {
  const stripeRouter = (await import("./stripe")).default;
  req.url = "/checkout";
  return (stripeRouter as any)(req, res, next);
});

// Update seat quantity on an active subscription (prorated by Stripe).
router.post("/seats", requireUser, async (req: UserRequest, res: Response) => {
  try {
    const user = req.user!;
    const seats = Number(req.body?.seats);
    if (!Number.isInteger(seats) || seats < 1 || seats > SINGLE_PLAN.maxSeats) {
      return res.status(400).json({ error: `Seats must be between 1 and ${SINGLE_PLAN.maxSeats}` });
    }
    if (!user.stripeSubscriptionId || user.subscriptionStatus !== "active") {
      return res.status(400).json({ error: "No active subscription to update" });
    }

    const updated = await stripeService.updateSubscriptionSeats(user.stripeSubscriptionId, seats);

    // Optimistically mirror locally; the subscription.updated webhook will confirm.
    await db.update(users).set({ seats }).where(eq(users.id, user.id));
    const { syncEntitlementFromUser } = await import("../lib/entitlements");
    await syncEntitlementFromUser(user.id);

    await db.insert(usageEvents).values({
      eventType: "seats_updated",
      sessionId: req.sessionID || null,
      details: { userId: user.id, seats, subscriptionId: user.stripeSubscriptionId },
    });

    res.json({ success: true, seats, subscriptionId: updated.id });
  } catch (error: any) {
    console.error("Seat update error:", error);
    res.status(500).json({ error: error.message || "Failed to update seats" });
  }
});

// Stripe customer portal — alias under /api/billing for the spec-required path.
router.post("/portal", requireUser, async (req: UserRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: "No billing account found" });
    }
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const session = await stripeService.createCustomerPortalSession(
      user.stripeCustomerId,
      `${baseUrl}/settings/billing`,
    );
    res.json({ url: session.url });
  } catch (error: any) {
    console.error("Billing portal error:", error);
    res.status(500).json({ error: error.message || "Failed to create portal session" });
  }
});

router.get("/reveals", requireUser, async (req: UserRequest, res: Response) => {
  const userId = req.user!.id;
  const limit = Math.min(parseInt((req.query.limit as string) || "50"), 200);
  const rows = await db
    .select()
    .from(contactReveals)
    .where(eq(contactReveals.userId, userId))
    .orderBy(desc(contactReveals.revealedAt))
    .limit(limit);
  res.json({ reveals: rows });
});

export default router;
