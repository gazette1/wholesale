/** Pure math for the reports page. Every function returns null when there is no answer, never NaN or Infinity. */

export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

/** A share between 0 and 1, for example contracts over leads. */
export function rate(part: number, whole: number): number | null {
  return safeDivide(part, whole);
}

export function average(values: number[]): number | null {
  const clean = values.filter(Number.isFinite);
  return safeDivide(clean.reduce((a, v) => a + v, 0), clean.length);
}

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** How many values are at or under the limit, for example first responses within 5 minutes. */
export function countAtOrUnder(values: number[], limit: number): number {
  return values.filter((v) => Number.isFinite(v) && v <= limit).length;
}

export function daysBetween(from: Date, to: Date): number | null {
  const ms = to.getTime() - from.getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms / 86_400_000 : null;
}
