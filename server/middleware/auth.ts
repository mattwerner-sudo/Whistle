import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface AuthenticatedSessionRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: string;
  };
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function requireAuth(req: AuthenticatedSessionRequest, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    req.user = { id: user.id, email: user.email, role: user.role ?? 'user' };
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Authentication check failed" });
  }
}

export async function requireAdmin(req: AuthenticatedSessionRequest, res: Response, next: NextFunction) {
  const adminSecret = process.env.ADMIN_SECRET;
  const providedSecret = req.headers['x-admin-secret'] as string | undefined;

  if (adminSecret && providedSecret && constantTimeCompare(providedSecret, adminSecret)) {
    req.user = { id: 0, email: 'admin@internal', role: 'admin' };
    return next();
  }

  if (!req.session?.userId) {
    return res.status(401).json({ error: "Authentication required. Use X-Admin-Secret header for admin access." });
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
    
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Authentication check failed" });
  }
}
