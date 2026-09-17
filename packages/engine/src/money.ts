/**
 * Excel parity helpers. Every function here is checked against cached values
 * from the workbook through the golden tests. No rounding for display happens
 * in the engine.
 */

/** Excel PMT. A positive pv returns a negative payment, like Excel. */
export function pmt(rate: number, nper: number, pv: number, fv = 0, type: 0 | 1 = 0): number {
  if (nper === 0) return NaN;
  if (rate === 0) return -(pv + fv) / nper;
  const pow = Math.pow(1 + rate, nper);
  return -(rate * (pv * pow + fv)) / ((pow - 1) * (1 + rate * type));
}

/** Excel CUMIPMT: cumulative interest paid between startPeriod and endPeriod inclusive. */
export function cumipmt(rate: number, nper: number, pv: number, startPeriod: number, endPeriod: number, type: 0 | 1 = 0): number {
  if (startPeriod < 1 || endPeriod < startPeriod || nper < endPeriod) return NaN;
  const payment = pmt(rate, nper, pv, 0, type);
  let balance = pv;
  let total = 0;
  for (let k = 1; k <= endPeriod; k++) {
    const interest = type === 1 && k === 1 ? 0 : -balance * rate;
    if (k >= startPeriod) total += interest;
    const principal = payment - interest;
    balance = balance + principal;
  }
  return total;
}

/** Excel ROUNDUP: rounds away from zero to the given number of digits. */
export function roundUp(value: number, digits = 0): number {
  if (!Number.isFinite(value)) return value;
  const factor = Math.pow(10, digits);
  const scaled = Math.abs(value) * factor;
  // Guard against binary noise such as 4.000000000000001 rounding up to 5.
  const cleaned = Number(scaled.toPrecision(15));
  return (Math.sign(value) || 1) * (Math.ceil(cleaned) / factor);
}

export function average(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sum(values: Array<number | null | undefined>): number {
  let total = 0;
  for (const v of values) total += v ?? 0;
  return total;
}

/** Days in each calendar month as typed on the Amortization sheet (row 2). No leap year. */
export const SHEET_DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Parse an ISO date (YYYY-MM-DD or a full ISO string) as a UTC calendar day. */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** 1-based month number of a UTC date, like Excel MONTH(). */
export function monthOf(date: Date): number {
  return date.getUTCMonth() + 1;
}

/** Real calendar days in the month of the given date, leap years included. */
export function calendarDaysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}
