import { Router } from "express";
import { db } from "../db";
import { alertSubscriptions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { requireUser, type UserRequest } from "../middleware/require-user";
import { z } from "zod";

const router = Router();

const upsertSchema = z.object({
  schoolId: z.string().nullable().optional(),
  signalTypes: z.array(z.string()).default([]),
  frequency: z.enum(["instant", "daily", "weekly"]).default("instant"),
  slackWebhookUrl: z.string().url().nullable().optional(),
});

// GET /api/alerts — list the current user's alert subscriptions
router.get("/", requireUser, async (req: UserRequest, res) => {
  try {
    const subs = await db
      .select()
      .from(alertSubscriptions)
      .where(eq(alertSubscriptions.userId, req.user!.id));
    res.json({ subscriptions: subs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alerts — create or update an alert subscription for a school
router.post("/", requireUser, async (req: UserRequest, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { schoolId, signalTypes, frequency, slackWebhookUrl } = parsed.data;

  try {
    // Upsert by (userId, schoolId)
    const existing = await db
      .select()
      .from(alertSubscriptions)
      .where(
        and(
          eq(alertSubscriptions.userId, req.user!.id),
          schoolId ? eq(alertSubscriptions.schoolId, schoolId) : eq(alertSubscriptions.userId, req.user!.id),
        ),
      )
      .limit(1);

    if (existing.length) {
      const [updated] = await db
        .update(alertSubscriptions)
        .set({ signalTypes, frequency, slackWebhookUrl: slackWebhookUrl ?? null, updatedAt: new Date() })
        .where(eq(alertSubscriptions.id, existing[0].id))
        .returning();
      return res.json({ subscription: updated });
    }

    const [created] = await db
      .insert(alertSubscriptions)
      .values({ userId: req.user!.id, schoolId: schoolId ?? null, signalTypes, frequency, slackWebhookUrl: slackWebhookUrl ?? null })
      .returning();
    res.status(201).json({ subscription: created });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/alerts/:id — remove a subscription
router.delete("/:id", requireUser, async (req: UserRequest, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [deleted] = await db
      .delete(alertSubscriptions)
      .where(and(eq(alertSubscriptions.id, id), eq(alertSubscriptions.userId, req.user!.id)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Subscription not found" });
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
