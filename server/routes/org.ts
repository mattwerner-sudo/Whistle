import { Router, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db } from "../db";
import { users, organizations, organizationMembers, organizationInvites } from "@shared/schema";
import { eq, and, count, isNull } from "drizzle-orm";
import { requireUser, UserRequest } from "../middleware/require-user";
import { sendMail } from "../lib/mailer";

const router = Router();

const inviteSchema = z.object({
  email: z.string().email(),
});

// Get org members and seat usage
router.get("/members", requireUser, async (req: UserRequest, res: Response) => {
  const user = req.user!;
  if (!user.organizationId) {
    return res.status(404).json({ error: "No organization found" });
  }

  const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
  if (!org) return res.status(404).json({ error: "Organization not found" });

  const members = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, role: organizationMembers.role, joinedAt: organizationMembers.createdAt })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, org.id));

  const pendingInvites = await db
    .select({ id: organizationInvites.id, email: organizationInvites.email, createdAt: organizationInvites.createdAt, expiresAt: organizationInvites.expiresAt })
    .from(organizationInvites)
    .where(and(eq(organizationInvites.organizationId, org.id), isNull(organizationInvites.acceptedAt)));

  res.json({
    seatLimit: org.seatLimit,
    seatsUsed: members.length,
    seatsAvailable: org.seatLimit === -1 ? null : Math.max(0, org.seatLimit - members.length),
    members,
    pendingInvites,
  });
});

// Invite a user by email
router.post("/invite", requireUser, async (req: UserRequest, res: Response) => {
  const user = req.user!;
  if (!user.organizationId) {
    return res.status(404).json({ error: "No organization found" });
  }

  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email" });
  }

  const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
  if (!org) return res.status(404).json({ error: "Organization not found" });

  // Only the org owner can invite
  if (org.ownerUserId !== user.id) {
    return res.status(403).json({ error: "Only the account owner can invite team members" });
  }

  // Pro plan (seatLimit=1) cannot invite anyone
  if (org.seatLimit === 1) {
    return res.status(403).json({ error: "Upgrade to Team or Enterprise to add team members", upgradeRequired: true });
  }

  // Check seat availability
  if (org.seatLimit !== -1) {
    const [{ value: memberCount }] = await db
      .select({ value: count() })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, org.id));

    if (memberCount >= org.seatLimit) {
      return res.status(403).json({ error: `Seat limit reached (${org.seatLimit} seats). Upgrade to add more members.`, upgradeRequired: true });
    }
  }

  // Don't re-invite someone already a member
  const [existingMember] = await db
    .select()
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .where(and(eq(users.email, parsed.data.email), eq(organizationMembers.organizationId, org.id)))
    .limit(1);

  if (existingMember) {
    return res.status(409).json({ error: "This person is already a member" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Upsert invite (replace any existing pending invite for this email+org)
  await db
    .insert(organizationInvites)
    .values({ organizationId: org.id, email: parsed.data.email, token, expiresAt })
    .onConflictDoNothing();

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  await sendMail({
    to: parsed.data.email,
    subject: `You've been invited to join ${user.fullName}'s Whistle team`,
    text: `${user.fullName} has invited you to join their Whistle account.\n\nClick here to accept:\n${baseUrl}/invite/accept?token=${token}\n\nThis link expires in 7 days.`,
  }).catch((err) => console.error("[Org invite] mail failed:", err));

  res.json({ success: true, email: parsed.data.email });
});

// Accept an invite via token
router.post("/invite/accept", requireUser, async (req: UserRequest, res: Response) => {
  const user = req.user!;
  const { token } = req.body;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Invalid token" });
  }

  const [invite] = await db
    .select()
    .from(organizationInvites)
    .where(and(eq(organizationInvites.token, token), isNull(organizationInvites.acceptedAt)))
    .limit(1);

  if (!invite) return res.status(404).json({ error: "Invite not found or already used" });
  if (invite.expiresAt < new Date()) return res.status(410).json({ error: "Invite has expired" });
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return res.status(403).json({ error: "This invite was sent to a different email address" });
  }

  // Re-check seat limit before accepting
  const [org] = await db.select().from(organizations).where(eq(organizations.id, invite.organizationId)).limit(1);
  if (!org) return res.status(404).json({ error: "Organization not found" });

  if (org.seatLimit !== -1) {
    const [{ value: memberCount }] = await db
      .select({ value: count() })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, org.id));

    if (memberCount >= org.seatLimit) {
      return res.status(403).json({ error: "No seats available. Ask the account owner to upgrade." });
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(users).set({ organizationId: org.id }).where(eq(users.id, user.id));
    await tx.insert(organizationMembers).values({ organizationId: org.id, userId: user.id, role: "member" });
    await tx.update(organizationInvites).set({ acceptedAt: new Date() }).where(eq(organizationInvites.id, invite.id));
  });

  res.json({ success: true, organizationId: org.id });
});

// Remove a member (owner only)
router.delete("/members/:userId", requireUser, async (req: UserRequest, res: Response) => {
  const user = req.user!;
  if (!user.organizationId) return res.status(404).json({ error: "No organization found" });

  const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
  if (!org) return res.status(404).json({ error: "Organization not found" });

  if (org.ownerUserId !== user.id) {
    return res.status(403).json({ error: "Only the account owner can remove members" });
  }

  const targetId = parseInt(req.params.userId);
  if (isNaN(targetId) || targetId === user.id) {
    return res.status(400).json({ error: "Cannot remove yourself" });
  }

  await db.transaction(async (tx) => {
    await tx.update(users).set({ organizationId: null }).where(eq(users.id, targetId));
    await tx
      .delete(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, targetId)));
  });

  res.json({ success: true });
});

export default router;
