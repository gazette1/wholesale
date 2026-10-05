/**
 * Input guards shared by server actions and route handlers. Two jobs:
 * keep bad input from reaching the database as a 500, and keep database
 * error text (SQL, parameters, org ids) away from the person using the app.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Route params go straight into uuid columns. Anything else is a 404, not a query. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** numeric(14,2) columns hold 12 digits before the decimal point. */
export const MAX_MONEY = 999_999_999_999;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Optional dollar amount. Blank is null. Rejects negatives unless allowed, and anything the column cannot hold. */
export function moneyField(raw: FormDataEntryValue | null | undefined, label: string, opts: { allowNegative?: boolean; required?: boolean; max?: number } = {}): Parsed<number | null> {
  const text = String(raw ?? "").trim().replace(/[$,\s]/g, "");
  if (text === "") return opts.required ? { ok: false, error: `Enter ${label.toLowerCase()}.` } : { ok: true, value: null };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number.` };
  if (!opts.allowNegative && n < 0) return { ok: false, error: `${label} must be zero or more.` };
  const max = opts.max ?? MAX_MONEY;
  if (Math.abs(n) > max) return { ok: false, error: `${label} must be no more than ${max.toLocaleString("en-US")}.` };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** Optional whole or decimal number inside a range. Blank is null. */
export function numberField(raw: FormDataEntryValue | null | undefined, label: string, min: number, max: number, opts: { integer?: boolean } = {}): Parsed<number | null> {
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: true, value: null };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number.` };
  if (opts.integer && !Number.isInteger(n)) return { ok: false, error: `${label} must be a whole number.` };
  if (n < min) return { ok: false, error: `${label} must be at least ${min}.` };
  if (n > max) return { ok: false, error: `${label} must be no more than ${max}.` };
  return { ok: true, value: n };
}

/** Trimmed text capped at a length, or null when blank. */
export function textField(raw: FormDataEntryValue | null | undefined, max: number): string | null {
  const text = String(raw ?? "").trim();
  return text ? text.slice(0, max) : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

/**
 * A date input posts "2026-08-15". new Date() reads that as midnight UTC, which shows as the
 * day before in US time zones. Noon UTC lands on the typed day everywhere the team works.
 */
export function dateOnlyField(raw: FormDataEntryValue | null | undefined): Parsed<Date | null> {
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, error: "Enter the date as year, month, day." };
  const d = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900 || d.getUTCFullYear() > 2200) return { ok: false, error: "That date is out of range." };
  return { ok: true, value: d };
}

/**
 * Message safe to show. Validation errors thrown by our own code pass through; anything that looks
 * like driver or SQL text is logged on the server and replaced with the fallback.
 */
export function friendlyError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : "";
  const internal = !message || message.length > 200 || /failed query|insert into|update "|delete from|select |params:|violates|syntax error|ECONN|invalid input syntax/i.test(message);
  if (internal) { console.error("[action error]", err); return fallback; }
  return message;
}
