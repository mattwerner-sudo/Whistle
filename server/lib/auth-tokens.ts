import crypto from "crypto";
import { db } from "../db";
import { authTokens } from "@shared/schema";
import { and, eq, isNull, gt } from "drizzle-orm";

export type TokenPurpose = "verify_email" | "reset_password";

const TTL_MS: Record<TokenPurpose, number> = {
  verify_email: 7 * 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
};

export async function createAuthToken(userId: number, purpose: TokenPurpose): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS[purpose]);
  await db.insert(authTokens).values({ userId, token, purpose, expiresAt });
  return token;
}

// Atomically mark the token used and return the owning userId.
// The UPDATE ... WHERE used_at IS NULL guarantees single-use even under
// concurrent requests — only one writer will actually flip used_at.
export async function consumeAuthToken(token: string, purpose: TokenPurpose): Promise<number | null> {
  const now = new Date();
  const rows = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.token, token),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning({ userId: authTokens.userId });
  return rows[0]?.userId ?? null;
}

export async function invalidateUserTokens(userId: number, purpose: TokenPurpose): Promise<void> {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
}
