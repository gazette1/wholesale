/**
 * Pure helpers for matching an inbound SMS sender to a stored contact phone.
 * The rule: compare digits only, and only the last 10 of them, on both sides. A sender with fewer
 * than 10 digits (a short code, an alphanumeric sender id, an empty value) never matches anyone.
 */

export const PHONE_MATCH_DIGITS = 10;

/** Every digit in the input, nothing else. */
export function phoneDigits(input: string | null | undefined): string {
  return String(input ?? "").replace(/\D/g, "");
}

/** The last 10 digits of a sender, or null when the sender has fewer than 10 digits and so cannot be matched. */
export function phoneMatchKey(input: string | null | undefined): string | null {
  const digits = phoneDigits(input);
  return digits.length >= PHONE_MATCH_DIGITS ? digits.slice(-PHONE_MATCH_DIGITS) : null;
}

/** True when the stored number and the sender share the same last 10 digits. Either side with fewer than 10 digits is never a match. */
export function phonesMatch(stored: string | null | undefined, sender: string | null | undefined): boolean {
  const a = phoneMatchKey(stored);
  const b = phoneMatchKey(sender);
  return a !== null && b !== null && a === b;
}

export type InboundCandidate = { id: string; orgId: string; lastOutboundAt?: Date | string | null; createdAt?: Date | string | null };

const time = (d: Date | string | null | undefined): number => {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Choose exactly one contact for an inbound message when several share the sender's number.
 * Contacts in an org that owns the receiving number win. After that the contact that was sent a message
 * most recently wins, then the newest contact. Returns null when there are no candidates.
 */
export function pickInboundContact<T extends InboundCandidate>(candidates: T[], receivingOrgIds: string[] = []): T | null {
  if (!candidates.length) return null;
  const owned = receivingOrgIds.length ? candidates.filter((c) => receivingOrgIds.includes(c.orgId)) : [];
  const pool = owned.length ? owned : candidates;
  return [...pool].sort((a, b) => time(b.lastOutboundAt) - time(a.lastOutboundAt) || time(b.createdAt) - time(a.createdAt) || a.id.localeCompare(b.id))[0] ?? null;
}
