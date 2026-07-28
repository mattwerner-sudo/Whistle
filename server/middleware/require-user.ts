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

// Single-plan model: any active subscription grants full access.
export function requireActiveSubscription() {
  return (req: UserRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (user.subscriptionStatus !== "active") {
      return res.status(403).json({
        error: "Active subscription required",
        subscriptionRequired: true,
      });
    }
    next();
  };
}
