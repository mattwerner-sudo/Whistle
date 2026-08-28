import { promises as dnsPromises } from "dns";
import type { EmailVerificationStatus } from "@shared/schema";

// FREE email verification layer (no paid API, no SMTP probe — port 25 is blocked
// in this environment). We combine three cheap, deterministic signals:
//   1. Syntax validation
//   2. Disposable / throwaway domain detection
//   3. Role / generic-prefix detection (info@, admin@, ...)
//   4. DNS MX-record lookup (with an A/AAAA-record fallback)
//
// Design rules:
//   - Any lookup error or timeout resolves to "unverified" (NEVER "undeliverable").
//   - Verification must never throw to callers — extraction can't be crashed by it.
//   - Resolvers are injectable so tests can run without real DNS.
//   - There is a clean `EmailVerifier` seam so a paid API can be dropped in later.

export interface VerificationResult {
  status: EmailVerificationStatus;
  reason: string;
  checkedAt: Date;
}

export interface EmailVerifier {
  verify(email: string): Promise<VerificationResult>;
}

// Injectable DNS resolvers (default to Node's dns/promises). Tests pass fakes.
export interface DnsResolvers {
  resolveMx: (hostname: string) => Promise<{ exchange: string; priority: number }[]>;
  resolve4: (hostname: string) => Promise<string[]>;
  resolve6: (hostname: string) => Promise<string[]>;
}

const DEFAULT_RESOLVERS: DnsResolvers = {
  resolveMx: (h) => dnsPromises.resolveMx(h),
  resolve4: (h) => dnsPromises.resolve4(h),
  resolve6: (h) => dnsPromises.resolve6(h),
};

const DNS_TIMEOUT_MS = 4000;
const MX_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// A compact list of common disposable/throwaway email domains. Not exhaustive —
// just the ones we most commonly see in scraped data.
const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "10minutemail.com",
  "temp-mail.org",
  "tempmail.com",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "fakeinbox.com",
  "sharklasers.com",
  "maildrop.cc",
  "mintemail.com",
  "mailnesia.com",
  "mohmal.com",
  "spamgourmet.com",
  "tempinbox.com",
  "emailondeck.com",
]);

// Generic / role-based local parts. These are real, deliverable inboxes but are
// shared aliases rather than a specific person — lower-value for 1:1 outreach, so
// we mark them "risky" rather than "verified".
const ROLE_PREFIXES = new Set<string>([
  "info",
  "admin",
  "administrator",
  "support",
  "sales",
  "contact",
  "hello",
  "help",
  "office",
  "team",
  "staff",
  "webmaster",
  "postmaster",
  "noreply",
  "no-reply",
  "donotreply",
  "marketing",
  "media",
  "press",
  "athletics",
  "general",
  "inquiries",
  "enquiries",
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dns_timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

interface MxCacheEntry {
  hasMailHost: boolean;
  expiresAt: number;
}

// Only an explicit "no such record" answer is negative evidence about
// deliverability. Everything else (timeouts, SERVFAIL, refused, network errors)
// is inconclusive and must bubble up so the caller returns "unverified" rather
// than a false "undeliverable".
function isNoRecordError(err: any): boolean {
  return err?.code === "ENOTFOUND" || err?.code === "ENODATA";
}

export class FreeEmailVerifier implements EmailVerifier {
  private mxCache = new Map<string, MxCacheEntry>();

  constructor(private resolvers: DnsResolvers = DEFAULT_RESOLVERS) {}

  async verify(email: string): Promise<VerificationResult> {
    const checkedAt = new Date();
    const normalized = (email ?? "").trim().toLowerCase();

    // 1. Syntax
    if (!normalized || !EMAIL_REGEX.test(normalized)) {
      return { status: "undeliverable", reason: "invalid_syntax", checkedAt };
    }

    const atIdx = normalized.lastIndexOf("@");
    const localPart = normalized.slice(0, atIdx);
    const domain = normalized.slice(atIdx + 1);

    // 2. Disposable domain
    if (DISPOSABLE_DOMAINS.has(domain)) {
      return { status: "undeliverable", reason: "disposable_domain", checkedAt };
    }

    // 3. DNS deliverability (MX with A/AAAA fallback). Errors -> unverified.
    let hasMailHost: boolean;
    try {
      hasMailHost = await this.domainHasMailHost(domain);
    } catch {
      return { status: "unverified", reason: "dns_error", checkedAt };
    }

    if (!hasMailHost) {
      return { status: "undeliverable", reason: "no_mx_or_a_record", checkedAt };
    }

    // 4. Role / generic prefix -> deliverable but lower value.
    const rolePrefix = localPart.split("+")[0];
    if (ROLE_PREFIXES.has(rolePrefix)) {
      return { status: "risky", reason: "role_based_address", checkedAt };
    }

    return { status: "verified", reason: "mx_ok", checkedAt };
  }

  private async domainHasMailHost(domain: string): Promise<boolean> {
    const cached = this.mxCache.get(domain);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.hasMailHost;
    }

    let hasMailHost = false;

    // Try MX first.
    try {
      const mx = await timeout(this.resolvers.resolveMx(domain), DNS_TIMEOUT_MS);
      if (mx && mx.length > 0 && mx.some((r) => r.exchange)) {
        hasMailHost = true;
      }
    } catch (err: any) {
      // ENOTFOUND / ENODATA just mean "no MX" — fall through to the A/AAAA check.
      // Any other error (timeout, SERVFAIL, network) is inconclusive -> bubble up
      // so the caller resolves to "unverified" instead of a false "undeliverable".
      if (!isNoRecordError(err)) throw err;
    }

    // RFC 5321 implicit MX: a domain with an A/AAAA record can still receive mail.
    if (!hasMailHost) {
      try {
        const a = await timeout(this.resolvers.resolve4(domain), DNS_TIMEOUT_MS);
        if (a && a.length > 0) hasMailHost = true;
      } catch (err: any) {
        if (!isNoRecordError(err)) throw err;
      }
    }
    if (!hasMailHost) {
      try {
        const aaaa = await timeout(this.resolvers.resolve6(domain), DNS_TIMEOUT_MS);
        if (aaaa && aaaa.length > 0) hasMailHost = true;
      } catch (err: any) {
        if (!isNoRecordError(err)) throw err;
      }
    }

    this.mxCache.set(domain, {
      hasMailHost,
      expiresAt: Date.now() + MX_CACHE_TTL_MS,
    });
    return hasMailHost;
  }
}

// Default singleton used by extraction / storage.
const defaultVerifier = new FreeEmailVerifier();

// Public entry point. Never throws: any unexpected failure -> "unverified".
export async function verifyEmail(
  email: string,
  verifier: EmailVerifier = defaultVerifier,
): Promise<VerificationResult> {
  try {
    return await verifier.verify(email);
  } catch {
    return { status: "unverified", reason: "verifier_error", checkedAt: new Date() };
  }
}

type ConfidenceScore = {
  name: number;
  title: number;
  email: number;
  phone: number;
  overall: number;
  emailBase?: number;
};

// Deliverability multipliers applied to the email sub-score. "unverified" is a
// no-op: we don't penalize a contact just because we couldn't check it.
const EMAIL_STATUS_MULTIPLIER: Record<EmailVerificationStatus, number> = {
  verified: 1.0,
  unverified: 1.0,
  risky: 0.7,
  undeliverable: 0.2,
};

// Recompute the confidence score after verification. Overall is a weighted blend
// of the four sub-scores (name .35 / title .30 / email .25 / phone .10).
export function applyVerificationToConfidence(
  confidence: ConfidenceScore | null | undefined,
  status: EmailVerificationStatus,
): ConfidenceScore | null | undefined {
  if (!confidence) return confidence;

  // Always recompute from the immutable base so repeated verification passes are
  // idempotent (risky->verified restores the full email score; nothing compounds).
  // Rows written before `emailBase` existed fall back to the current email score,
  // which becomes the base from this point on.
  const base = confidence.emailBase ?? confidence.email;
  const multiplier = EMAIL_STATUS_MULTIPLIER[status] ?? 1.0;
  const email = Math.round(base * multiplier);
  const overall = Math.round(
    confidence.name * 0.35 +
      confidence.title * 0.30 +
      email * 0.25 +
      confidence.phone * 0.10,
  );

  return { ...confidence, emailBase: base, email, overall };
}
