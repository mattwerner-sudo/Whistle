// In-memory sliding-window rate limiter for the login endpoint.
// Keyed by ip+email so an attacker can't lock a victim out by hammering their
// email from a single IP without also locking themselves.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

interface Bucket {
  attempts: number[];
}

const buckets = new Map<string, Bucket>();

function keyFor(ip: string, email: string): string {
  return `${ip}::${email.toLowerCase()}`;
}

function prune(bucket: Bucket): void {
  const cutoff = Date.now() - WINDOW_MS;
  bucket.attempts = bucket.attempts.filter((t) => t > cutoff);
}

export function checkLoginRate(ip: string, email: string): { allowed: boolean; retryAfterSec: number } {
  const bucket = buckets.get(keyFor(ip, email));
  if (!bucket) return { allowed: true, retryAfterSec: 0 };
  prune(bucket);
  if (bucket.attempts.length < MAX_ATTEMPTS) return { allowed: true, retryAfterSec: 0 };
  const oldest = bucket.attempts[0];
  const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000));
  return { allowed: false, retryAfterSec };
}

export function recordLoginFailure(ip: string, email: string): void {
  const key = keyFor(ip, email);
  const bucket = buckets.get(key) ?? { attempts: [] };
  prune(bucket);
  bucket.attempts.push(Date.now());
  buckets.set(key, bucket);
}

export function resetLoginRate(ip: string, email: string): void {
  buckets.delete(keyFor(ip, email));
}
