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

export function apiError(status: number, error: string, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "cache-control": "no-store", ...headers } });
}

function readKey(request: NextRequest): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) return m[1]!;
  }
  return request.headers.get("x-api-key")?.trim() || null;
}

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * Authenticate an /api/v1 request with "Authorization: Bearer <key>" or "X-Api-Key: <key>".
 * Returns the verified key, or a ready 401 or 429 response. The key itself is never logged.
 */
export async function authenticateApiRequest(request: NextRequest): Promise<{ key: VerifiedKey; headers: Record<string, string> } | { response: NextResponse }> {
  await ensureDevDatabase();
  const raw = readKey(request);
  // Failed attempts are limited per client address so key guessing is slow.
  const addr = `addr:${clientAddress(request)}`;
  if (!raw) {
    return { response: apiError(401, "Missing API key. Send Authorization: Bearer <key> or X-Api-Key: <key>.", { "www-authenticate": "Bearer" }) };
  }
  const key = await verifyApiKey(raw);
  if (!key) {
    const miss = take(addr, 30);
    if (!miss.allowed) return { response: apiError(429, "Too many failed attempts. Try again later.", { "retry-after": String(miss.retryAfter) }) };
    return { response: apiError(401, "Invalid or revoked API key.", { "www-authenticate": "Bearer" }) };
  }
  const hit = take(`key:${key.keyId}`, RATE_LIMIT);
  const headers = { "x-ratelimit-limit": String(RATE_LIMIT), "x-ratelimit-remaining": String(hit.remaining), "cache-control": "no-store" };
  if (!hit.allowed) return { response: apiError(429, `Rate limit of ${RATE_LIMIT} requests per minute exceeded.`, { ...headers, "retry-after": String(hit.retryAfter) }) };
  return { key, headers };
}
