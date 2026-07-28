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

export function requireAuth(req: AuthenticatedSessionRequest, res: Response, next: NextFunction) {
  next();
}

/**
 * Default-deny gate for all /api routes.
 *
 * Every /api request must carry a logged-in session unless it matches the
 * public allowlist below, presents an X-Admin-Secret header (validated by the
 * route-level requireAdmin / requireAdminAccess middleware), or targets
 * /api/v1 (which enforces its own per-key auth via validateApiKey on every
 * route).
 *
 * Note: Stripe webhooks (/api/stripe/webhook, /api/billing/webhook) are
 * registered BEFORE this gate in server/index.ts, so they are unaffected.
 */
const PUBLIC_API_PREFIXES = [
  "/api/auth/",          // register / login / password reset / oauth
  "/api/docs",           // Swagger UI + spec (public API product docs)
  "/api/v1/",            // external API — every route enforces validateApiKey
];

const PUBLIC_API_EXACT = new Set([
  "/api/billing/plans",          // pricing config for the public pricing page
  "/api/stripe/publishable-key", // public by design
  "/api/stripe/products",        // public pricing catalog
]);

export function requireApiAuth(req: AuthenticatedSessionRequest, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next();

  const path = req.path.replace(/\/+$/, "") || req.path;
  if (PUBLIC_API_EXACT.has(path)) return next();
  if (PUBLIC_API_PREFIXES.some((p) => req.path === p.replace(/\/$/, "") || req.path.startsWith(p))) {
    return next();
  }

  // Admin tooling authenticates with X-Admin-Secret. The value is validated
  // here with a constant-time comparison — a wrong secret is rejected
  // immediately and never falls through to session-less access.
  const providedAdminSecret = req.headers["x-admin-secret"];
  if (typeof providedAdminSecret === "string") {
    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret && constantTimeCompare(providedAdminSecret, adminSecret)) {
      return next();
    }
    return res.status(401).json({ error: "Invalid admin secret" });
  }

  if (req.session?.userId) return next();

  return res.status(401).json({ error: "Authentication required" });
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
