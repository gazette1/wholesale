/** Sortable order keys. Keys are base 62 strings compared as plain strings, read as fractions. */

export const ORDER_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = ORDER_DIGITS[0]!;

export function isValidOrderKey(key: string): boolean {
  if (key.length === 0 || key.length > 64) return false;
  for (const ch of key) if (!ORDER_DIGITS.includes(ch)) return false;
  return true;
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while (n < b.length && (a[n] ?? ZERO) === b[n]) n++;
    if (n === b.length) throw new Error("No order key fits between these two keys");
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a.length > 0 ? ORDER_DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? ORDER_DIGITS.indexOf(b[0]!) : ORDER_DIGITS.length;
  if (digitB - digitA > 1) return ORDER_DIGITS[Math.round((digitA + digitB) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return ORDER_DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/**
 * A key that sorts strictly between a and b. Pass null for "before everything" or "after everything".
 * Throws when a is not below b or when no key fits.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && !isValidOrderKey(a)) throw new Error(`Invalid order key: ${a}`);
  if (b !== null && !isValidOrderKey(b)) throw new Error(`Invalid order key: ${b}`);
  if (a !== null && b !== null && a >= b) throw new Error("The first key must sort before the second");
  const result = midpoint(a ?? "", b);
  if ((a !== null && result <= a) || (b !== null && result >= b)) throw new Error("No order key fits between these two keys");
  return result;
}

/** n keys in order between a and b, for inserting several items at once. */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  const out: string[] = [];
  let prev = a;
  for (let i = 0; i < n; i++) {
    prev = keyBetween(prev, b);
    out.push(prev);
  }
  return out;
}

export function compareOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stable sort by the order key, without changing the input array. */
export function sortByOrder<T extends { order: string }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((x, y) => compareOrder(x.item.order, y.item.order) || x.index - y.index)
    .map((x) => x.item);
}
