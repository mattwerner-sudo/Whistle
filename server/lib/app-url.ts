import type { Request } from "express";

// Resolve the user-facing base URL for outbound links (verification emails,
// password reset links, OAuth redirect URIs).
//
// We deliberately do NOT trust request Host/X-Forwarded-Host headers here:
// those are attacker-controlled and could be used to poison reset links and
// steal tokens (host header injection -> account takeover).
//
// Resolution order:
//   1. APP_URL env var (set this in production)
//   2. REPLIT_DEV_DOMAIN (Replit dev workspace)
//   3. First entry of REPLIT_DOMAINS (Replit deployment)
//   4. http://localhost:5000 (local dev only)
export function getAppUrl(_req?: Request): string {
  const explicit = process.env.APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const replitDev = process.env.REPLIT_DEV_DOMAIN;
  if (replitDev) return `https://${replitDev}`;
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const first = replitDomains.split(",")[0].trim();
    if (first) return `https://${first}`;
  }
  return "http://localhost:5000";
}
