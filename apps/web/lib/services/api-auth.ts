import { NextResponse, type NextRequest } from "next/server";
import { ensureDevDatabase } from "@dealcalc/db";
import { verifyApiKey, type VerifiedKey } from "./integrations";

/**
 * Fixed window rate limit held in process memory. It is per server instance: on serverless hosting each
 * instance counts on its own, so the effective ceiling is the limit times the number of warm instances.
 * It stops a runaway Zap or a retry loop; it is not a security boundary.
 */
const RATE_LIMIT = 120;
const WINDOW_MS = 60_000;
const windows = new Map<string, { start: number; count: number }>();

function take(bucket: string, limit: number): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  if (windows.size > 5000) for (const [k, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(k);
  let w = windows.get(bucket);
  if (!w || now - w.start >= WINDOW_MS) { w = { start: now, count: 0 }; windows.set(bucket, w); }
  w.count += 1;
  const retryAfter = Math.max(1, Math.ceil((w.start + WINDOW_MS - now) / 1000));
  return { allowed: w.count <= limit, remaining: Math.max(0, limit - w.count), retryAfter };
}

/** True when the bucket has already used its allowance in the current window. Does not count as an attempt. */
function exhausted(bucket: string, limit: number): number | null {
  const w = windows.get(bucket);
  const now = Date.now();
  if (!w || now - w.start >= WINDOW_MS || w.count < limit) return null;
  return Math.max(1, Math.ceil((w.start + WINDOW_MS - now) / 1000));
}

export function apiError(status: number, error: string, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** Keys offered by the request, bearer first. Both headers may be present; each distinct value gets one try. */
function readKeys(request: NextRequest): string[] {
  const out: string[] = [];
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) out.push(m[1]!);
  }
  const header = request.headers.get("x-api-key")?.trim();
  if (header && !out.includes(header)) out.push(header);
  return out;
}

/**
 * Best available client address for the failed attempt limiter. Headers set by the hosting platform come first because
 * the caller cannot change them. X-Forwarded-For is a list that each proxy appends to, so only the last hop was written by
 * infrastructure; the first hop is whatever the caller typed and is never used. With no proxy header at all, every caller
 * shares one bucket, which is why the global budget below exists.
 */
function clientAddress(request: NextRequest): string {
  const platform = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim();
  if (platform) return platform.slice(0, 64);
  const hops = (request.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return (hops[hops.length - 1] ?? "unknown").slice(0, 64);
}

/** Failed key attempts allowed per client address per minute. */
const FAILED_PER_ADDRESS = 30;
/** Failed key attempts allowed per minute across all callers on this instance, so rotating addresses or headers does not buy more guesses. */
const FAILED_GLOBAL = 300;

/**
 * Authenticate an /api/v1 request with "Authorization: Bearer <key>" or "X-Api-Key: <key>". When both are sent the bearer
 * value is tried first and the header key second. Returns the verified key, or a ready 401 or 429 response. The key itself is never logged.
 */
export async function authenticateApiRequest(request: NextRequest): Promise<{ key: VerifiedKey; headers: Record<string, string> } | { response: NextResponse }> {
  await ensureDevDatabase();
  const offered = readKeys(request);
  if (!offered.length) {
    return { response: apiError(401, "Missing API key. Send Authorization: Bearer <key> or X-Api-Key: <key>.", { "www-authenticate": "Bearer" }) };
  }
  // An address that has used up its failed attempts is refused before the key is checked, so a correct guess made while
  // limited looks the same as a wrong one. The global budget is not checked here: it would let one noisy caller lock out
  // every valid key on the instance.
  const addrBucket = `addr:${clientAddress(request)}`;
  const wait = exhausted(addrBucket, FAILED_PER_ADDRESS);
  if (wait !== null) return { response: apiError(429, "Too many failed attempts. Try again later.", { "retry-after": String(wait) }) };
  let key: VerifiedKey | null = null;
  for (const raw of offered) { key = await verifyApiKey(raw); if (key) break; }
  if (!key) {
    // Failed attempts are limited per client address and in total, so key guessing is slow however the caller presents itself.
    const mine = take(addrBucket, FAILED_PER_ADDRESS);
    const everyone = take("failed:all", FAILED_GLOBAL);
    if (!mine.allowed || !everyone.allowed) {
      const retryAfter = !mine.allowed ? mine.retryAfter : everyone.retryAfter;
      return { response: apiError(429, "Too many failed attempts. Try again later.", { "retry-after": String(retryAfter) }) };
    }
    return { response: apiError(401, "Invalid or revoked API key.", { "www-authenticate": "Bearer" }) };
  }
  const hit = take(`key:${key.keyId}`, RATE_LIMIT);
  const headers = { "x-ratelimit-limit": String(RATE_LIMIT), "x-ratelimit-remaining": String(hit.remaining), "cache-control": "no-store" };
  if (!hit.allowed) return { response: apiError(429, `Rate limit of ${RATE_LIMIT} requests per minute exceeded.`, { ...headers, "retry-after": String(hit.retryAfter) }) };
  return { key, headers };
}
