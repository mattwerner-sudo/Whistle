import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { users, type User } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface UserRequest extends Request {
  user?: User;
}

export async function requireUser(req: UserRequest, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const [user] = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  req.user = user;
  next();
}

export async function attachUser(req: UserRequest, _res: Response, next: NextFunction) {
  if (req.session?.userId) {
    const [user] = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
    if (user) req.user = user;
  }
  next();
}

const PLAN_RANK: Record<string, number> = {
  free: 0,
  payg: 1,
  pro: 2,
  team: 3,
  enterprise: 4,
};

export function requirePlan(min: "pro" | "team" | "enterprise") {
  return (req: UserRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Authentication required" });
    const tier = user.subscriptionTier || "payg";
    const active = user.subscriptionStatus === "active";
    const userRank = active ? (PLAN_RANK[tier] ?? 0) : 0;
    if (userRank < PLAN_RANK[min]) {
      return res.status(403).json({
        error: "Plan upgrade required",
        requiredPlan: min,
        currentPlan: tier,
      });
    }
    next();
  };
}
