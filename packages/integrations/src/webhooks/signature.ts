import { createHmac, timingSafeEqual } from "node:crypto";

/** Default replay window for webhook timestamps, in seconds. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * HMAC-SHA256 over "{timestamp}.{body}" with the endpoint secret, hex encoded.
 * The timestamp is Unix seconds as a string, sent in X-DealCalc-Timestamp.
 * The header value is "sha256=" plus this hex digest.
 */
export function signPayload(secret: string, timestamp: string | number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/** Constant time comparison of two strings. Returns false when lengths differ. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a webhook signature. Accepts "sha256=<hex>" or the bare hex digest.
 * Rejects timestamps further than toleranceSeconds from now (default 5 minutes) to limit replay.
 */
export function verifySignature(input: { secret: string; timestamp: string | number; body: string; signature: string | null | undefined; toleranceSeconds?: number; now?: number }): boolean {
  const { secret, timestamp, body, signature } = input;
  if (!secret || !signature) return false;
  if (timestamp === "" || timestamp === null || timestamp === undefined) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - ts) > tolerance) return false;
  const provided = signature.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  return safeEqual(signPayload(secret, String(timestamp), body), provided);
}
