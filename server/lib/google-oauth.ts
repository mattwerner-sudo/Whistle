// Google OAuth helper. End users sign in with their Google account.
// Configuration: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env. The
// redirect URI must match what's registered in the Google Cloud Console;
// we compute it from the app's base URL as <APP_URL>/api/auth/google/callback.

import crypto from "crypto";

export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function generateState(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export async function exchangeCodeForUser(code: string, redirectUri: string): Promise<GoogleUserInfo> {
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResp.ok) {
    const body = await tokenResp.text();
    throw new Error(`Google token exchange failed (${tokenResp.status}): ${body.slice(0, 200)}`);
  }
  const tokens = (await tokenResp.json()) as { access_token: string };
  const userResp = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userResp.ok) {
    throw new Error(`Google userinfo failed (${userResp.status})`);
  }
  return (await userResp.json()) as GoogleUserInfo;
}
