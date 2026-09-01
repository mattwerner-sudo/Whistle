import { Router, Request, Response } from "express";
import { db } from "../db";
import { users, authTokens, registerSchema, loginSchema, organizations, organizationMembers } from "@shared/schema";
import { hashPassword, verifyPassword } from "../lib/auth-utils";
import { syncEntitlementFromUser } from "../lib/entitlements";
import { sendMail } from "../lib/mailer";
import { createAuthToken, consumeAuthToken, invalidateUserTokens } from "../lib/auth-tokens";
import { checkLoginRate, recordLoginFailure, resetLoginRate } from "../lib/login-rate-limit";
import { getAppUrl } from "../lib/app-url";
import {
  isGoogleConfigured,
  generateState,
  buildAuthUrl,
  exchangeCodeForUser,
} from "../lib/google-oauth";
import { eq } from "drizzle-orm";
import { z } from "zod";

declare module "express-session" {
  interface SessionData {
    userId: number;
    oauthState?: string;
  }
}

const router = Router();

function clientIp(req: Request): string {
  // app.set('trust proxy', 1) makes req.ip the real client IP via the
  // hosting proxy chain. We do not read X-Forwarded-For ourselves because
  // it is user-controlled and would defeat per-IP rate limiting.
  return req.ip || "unknown";
}

async function sendVerificationEmail(userId: number, email: string, fullName: string, baseUrl: string) {
  await invalidateUserTokens(userId, "verify_email");
  const token = await createAuthToken(userId, "verify_email");
  const link = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: email,
    subject: "Verify your Whistle email",
    text: `Hi ${fullName || "there"},\n\nConfirm your email so we can keep your Whistle account secure:\n\n${link}\n\nThis link expires in 7 days.\n\nIf you didn't sign up for Whistle, you can ignore this email.`,
  });
}

router.post("/register", async (req: Request, res: Response) => {
  try {
    const result = registerSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      });
    }

    const { email, password, fullName } = result.data;
    // `acceptedTos` is enforced by registerSchema (z.literal(true)). We
    // additionally stamp the acceptance time on the user row below.

    const existingUser = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existingUser.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await hashPassword(password);

    const [newUser] = await db.insert(users).values({
      email: email.toLowerCase(),
      passwordHash,
      fullName,
      role: "user",
      isVerified: false,
      tosAcceptedAt: new Date(),
    }).returning();

    // Create a default org (Pro/1 seat) for every new user so the seat model
    // is always consistent. seatLimit will be updated by the Stripe webhook when
    // they subscribe to a paid plan.
    const [org] = await db.insert(organizations).values({
      name: `${fullName}'s Team`,
      ownerUserId: newUser.id,
      seatLimit: 1,
    }).returning();
    await db.update(users).set({ organizationId: org.id }).where(eq(users.id, newUser.id));
    await db.insert(organizationMembers).values({ organizationId: org.id, userId: newUser.id, role: "owner" });

    // Seed a default entitlements row so plan/quota state is always queryable.
    await syncEntitlementFromUser(newUser.id);

    // Fire-and-forget verification email; don't block signup on mail failures.
    sendVerificationEmail(newUser.id, newUser.email, newUser.fullName, getAppUrl(req)).catch((err) => {
      console.error("Verification email send failed:", err);
    });

    req.session.regenerate((err) => {
      if (err) {
        console.error("Session regenerate error:", err);
        return res.status(500).json({ error: "Registration failed" });
      }
      req.session.userId = newUser.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("Session save error:", saveErr);
          return res.status(500).json({ error: "Registration failed" });
        }
        res.status(201).json({
          success: true,
          user: {
            id: newUser.id,
            email: newUser.email,
            fullName: newUser.fullName,
            role: newUser.role,
          },
        });
      });
    });
  } catch (error: any) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  try {
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      });
    }

    const { email, password } = result.data;
    const ip = clientIp(req);

    const rate = checkLoginRate(ip, email);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      return res.status(429).json({
        error: `Too many failed attempts. Try again in ${Math.ceil(rate.retryAfterSec / 60)} minute(s).`,
      });
    }

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user || !user.passwordHash) {
      recordLoginFailure(ip, email);
      // Hint that a Google-only account exists so the user picks the right method.
      if (user && !user.passwordHash) {
        return res.status(401).json({ error: "This account uses Google sign-in. Click \"Continue with Google\" instead." });
      }
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      recordLoginFailure(ip, email);
      return res.status(401).json({ error: "Invalid email or password" });
    }

    resetLoginRate(ip, email);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    req.session.regenerate((err) => {
      if (err) {
        console.error("Session regenerate error:", err);
        return res.status(500).json({ error: "Login failed" });
      }
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("Session save error:", saveErr);
          return res.status(500).json({ error: "Login failed" });
        }
        res.json({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
          },
        });
      });
    });
  } catch (error: any) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

router.post("/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ error: "Logout failed" });
    }
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

router.get("/me", async (req: Request, res: Response) => {
  try {
    if (req.session.userId) {
      const [user] = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
      if (user) {
        return res.json({
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            isVerified: user.isVerified,
            creditsBalance: user.creditsBalance,
            subscriptionStatus: user.subscriptionStatus,
            subscriptionTier: user.subscriptionTier,
            monthlyCreditsAllocation: user.monthlyCreditsAllocation,
            creditsUsedThisPeriod: user.creditsUsedThisPeriod,
            currentPeriodEnd: user.currentPeriodEnd,
            trialSchoolId: user.trialSchoolId,
          },
        });
      }
    }

    res.json({ user: null });
  } catch (error: any) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Failed to get user" });
  }
});

// ----- Email verification -----

router.post("/verify-email", async (req: Request, res: Response) => {
  const schema = z.object({ token: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid token" });
  const userId = await consumeAuthToken(parsed.data.token, "verify_email");
  if (!userId) return res.status(400).json({ error: "This verification link is invalid or has expired." });
  await db.update(users).set({ isVerified: true }).where(eq(users.id, userId));
  res.json({ success: true });
});

router.post("/resend-verification", async (req: Request, res: Response) => {
  if (!req.session.userId) return res.status(401).json({ error: "Authentication required" });
  const [user] = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (user.isVerified) return res.json({ success: true, alreadyVerified: true });
  await sendVerificationEmail(user.id, user.email, user.fullName, getAppUrl(req));
  res.json({ success: true });
});

// ----- Password reset -----

router.post("/forgot-password", async (req: Request, res: Response) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  // Always return success to avoid email enumeration.
  if (!parsed.success) return res.json({ success: true });
  const email = parsed.data.email.toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user && user.passwordHash) {
    try {
      await invalidateUserTokens(user.id, "reset_password");
      const token = await createAuthToken(user.id, "reset_password");
      const link = `${getAppUrl(req)}/reset-password/${encodeURIComponent(token)}`;
      await sendMail({
        to: user.email,
        subject: "Reset your Whistle password",
        text: `Hi ${user.fullName || "there"},\n\nWe got a request to reset your Whistle password. Click the link below to set a new one. This link expires in 1 hour and can only be used once.\n\n${link}\n\nIf you didn't ask for a reset, you can safely ignore this email.`,
      });
    } catch (err) {
      console.error("Forgot-password send failed:", err);
    }
  }
  res.json({ success: true });
});

router.post("/reset-password", async (req: Request, res: Response) => {
  const schema = z.object({
    token: z.string().min(1),
    password: z.string().min(8, "Password must be at least 8 characters"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid request" });
  }
  const userId = await consumeAuthToken(parsed.data.token, "reset_password");
  if (!userId) return res.status(400).json({ error: "This reset link is invalid or has expired." });
  const passwordHash = await hashPassword(parsed.data.password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));

  // Revoke every existing session for this user so a stolen cookie can't
  // outlive the password reset.
  try {
    const { pool } = await import("../db");
    await pool.query(
      `DELETE FROM sessions WHERE sess->>'userId' = $1`,
      [String(userId)],
    );
  } catch (err) {
    console.error("Session revocation after password reset failed:", err);
  }

  res.json({ success: true });
});

// ----- Google OAuth -----

router.get("/google/start", async (req: Request, res: Response) => {
  if (!isGoogleConfigured()) {
    return res.status(503).send("Google sign-in is not configured on this server.");
  }
  const state = generateState();
  req.session.oauthState = state;
  req.session.save(() => {
    const redirectUri = `${getAppUrl(req)}/api/auth/google/callback`;
    res.redirect(buildAuthUrl(redirectUri, state));
  });
});

router.get("/google/callback", async (req: Request, res: Response) => {
  try {
    if (!isGoogleConfigured()) return res.status(503).send("Google sign-in is not configured.");
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    if (oauthError) return res.redirect(`/login?error=${encodeURIComponent(oauthError)}`);
    if (!code || !state || state !== req.session.oauthState) {
      return res.redirect("/login?error=invalid_oauth_state");
    }
    delete req.session.oauthState;

    const redirectUri = `${getAppUrl(req)}/api/auth/google/callback`;
    const info = await exchangeCodeForUser(code, redirectUri);
    if (!info.email || !info.email_verified) {
      return res.redirect("/login?error=email_unverified");
    }

    const email = info.email.toLowerCase();
    let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user) {
      [user] = await db.insert(users).values({
        email,
        passwordHash: null,
        googleId: info.sub,
        fullName: info.name || email,
        role: "user",
        isVerified: true,
        // Clicking "Continue with Google" on /login implies acceptance of the
        // Terms & Privacy Policy linked next to the button.
        tosAcceptedAt: new Date(),
      }).returning();
      await syncEntitlementFromUser(user.id);
    } else if (!user.googleId) {
      // Account exists with password — for v1 we refuse to silently link.
      if (user.passwordHash) {
        return res.redirect("/login?error=use_password_signin");
      }
      [user] = await db
        .update(users)
        .set({ googleId: info.sub, isVerified: true })
        .where(eq(users.id, user.id))
        .returning();
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    req.session.regenerate((err) => {
      if (err) {
        console.error("Session regenerate error (google):", err);
        return res.redirect("/login?error=session");
      }
      req.session.userId = user!.id;
      req.session.save(() => res.redirect("/dashboard"));
    });
  } catch (err: any) {
    console.error("Google callback error:", err?.message || err);
    res.redirect("/login?error=google_failed");
  }
});

router.get("/google/config", (_req: Request, res: Response) => {
  res.json({ enabled: isGoogleConfigured() });
});

export default router;
