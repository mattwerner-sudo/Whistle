import { Router, Request, Response } from "express";
import { db } from "../db";
import { enterpriseInquiries, enterpriseInquiryRequestSchema, contactReveals, usageEvents } from "@shared/schema";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import { requireUser, UserRequest } from "../middleware/require-user";
import { REVEAL_GRACE_DAYS } from "../lib/contact-masking";
import { sendMail, getFounderEmail } from "../lib/mailer";
import { stripeService } from "../stripeService";

const router = Router();

export const PLAN_CATALOG = {
  pro: {
    id: "pro",
    name: "Pro",
    annualPrice: 240000,       // $2,400/yr in cents
    includedReveals: 2400,     // 200/mo equivalent
    overageRateCents: 50,      // $0.50/reveal
    seats: 1,
    description: "2,400 reveals/year + $0.50 each after. 1 seat.",
    lookupKey: "whistle_pro_annual",
  },
  team: {
    id: "team",
    name: "Team",
    annualPrice: 720000,       // $7,200/yr in cents
    includedReveals: 9600,     // 800/mo equivalent
    overageRateCents: 35,      // $0.35/reveal
    seats: 5,
    description: "9,600 reveals/year + $0.35 each after. Up to 5 seats.",
    lookupKey: "whistle_team_annual",
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    annualPrice: 1800000,      // $18,000/yr in cents
    includedReveals: 36000,    // 3,000/mo equivalent
    overageRateCents: 25,      // $0.25/reveal
    seats: -1,                 // unlimited
    description: "36,000 reveals/year + $0.25 each after. Unlimited seats + API access.",
    lookupKey: "whistle_enterprise_annual",
  },
} as const;

router.get("/plans", (_req: Request, res: Response) => {
  res.json({ plans: Object.values(PLAN_CATALOG) });
});

router.get("/account", requireUser, async (req: UserRequest, res: Response) => {
  const user = req.user!;
  const periodStart = user.currentPeriodStart ?? null;
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
  const { getEntitlement } = await import("../lib/entitlements");
  const { syncEntitlementFromUser } = await import("../lib/entitlements");
  let ent = await getEntitlement(user.id);
  if (!ent) {
    await syncEntitlementFromUser(user.id);
    ent = await getEntitlement(user.id);
  }
  const tier = ent?.tier ?? user.subscriptionTier ?? "pro";
  const plan = (PLAN_CATALOG as any)[tier] ?? PLAN_CATALOG.pro;
  const used = ent?.usedThisPeriod ?? user.creditsUsedThisPeriod ?? 0;
  const allocation = ent?.monthlyAllocation ?? user.monthlyCreditsAllocation ?? 0;
  const overageThisPeriod = Math.max(0, used - allocation);
  const overageCostCents = overageThisPeriod * (plan.overageRateCents ?? 0);

  res.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    },
    plan: {
      id: plan.id,
      name: plan.name,
      status: ent?.status ?? user.subscriptionStatus ?? "inactive",
      annualPriceCents: plan.annualPrice,
      includedReveals: allocation || plan.includedReveals,
      overageRateCents: plan.overageRateCents,
      currentPeriodStart: periodStart,
      currentPeriodEnd: user.currentPeriodEnd ?? null,
    },
    usage: {
      revealsThisPeriod: used,
      overageThisPeriod,
      overageCostCents,
      lifetimeReveals: revealCount?.count ?? 0,
      activeRevealsInGrace: recentReveals?.count ?? 0,
    },
  });
});

router.post("/enterprise-inquiry", async (req: Request, res: Response) => {
  const parsed = enterpriseInquiryRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
  }
  const userId = req.session?.userId ?? null;
  const [created] = await db
    .insert(enterpriseInquiries)
    .values({ ...parsed.data, userId })
    .returning();

  await db.insert(usageEvents).values({
    eventType: "enterprise_inquiry",
    sessionId: req.sessionID || null,
    details: { inquiryId: created.id, email: parsed.data.email, company: parsed.data.company },
  });

  console.log(`[Enterprise Inquiry] ${parsed.data.email} (${parsed.data.company || "n/a"}): ${parsed.data.message.slice(0, 200)}`);

  // Notify founder. Non-blocking failure: we already persisted the inquiry.
  const founder = getFounderEmail();
  sendMail({
    to: founder,
    replyTo: parsed.data.email,
    subject: `[Whistle] Enterprise inquiry from ${parsed.data.company || parsed.data.email}`,
    text: [
      `Name: ${parsed.data.name || "n/a"}`,
      `Email: ${parsed.data.email}`,
      `Company: ${parsed.data.company || "n/a"}`,
      `Phone: ${(parsed.data as any).phone || "n/a"}`,
      ``,
      parsed.data.message,
    ].join("\n"),
  }).catch((err) => console.error("[Enterprise Inquiry] mail failed:", err));

  res.json({ success: true, id: created.id });
});

// Stripe checkout — spec-required alias under /api/billing.
// Delegates to the existing handler in server/routes/stripe.ts.
router.post("/checkout", async (req: Request, res: Response, next) => {
  const stripeRouter = (await import("./stripe")).default;
  req.url = "/checkout";
  return (stripeRouter as any)(req, res, next);
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
