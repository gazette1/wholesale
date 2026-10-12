/** Shared value helpers for rules, validation, and migration. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Empty means undefined, null, a blank string, or an empty array. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function normalizeText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim().toLowerCase();
}

/** A finite number from a number or a numeric string, otherwise null. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim().replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const t = normalizeText(value);
  if (t === "true" || t === "yes") return true;
  if (t === "false" || t === "no") return false;
  return null;
}

function realCalendarDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True for a real YYYY-MM-DD date, or an ISO date time when withTime is set. */
export function isIsoDate(value: unknown, withTime = false): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_RE.exec(value) ?? (withTime ? ISO_DATE_TIME_RE.exec(value) : null);
  if (!m) return false;
  if (!realCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]))) return false;
  return !Number.isNaN(Date.parse(value));
}

/** Milliseconds for an ISO date or date time; date only values read as UTC midnight. */
export function toTime(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== "string") return null;
  if (!isIsoDate(value, true)) return null;
  return Date.parse(value);
}

/** The YYYY-MM-DD part of an ISO date or date time. */
export function isoDay(value: string): string {
  return value.slice(0, 10);
}

/** "12 Oct 2026" from an ISO date. */
export function formatDay(iso: string): string {
  const m = ISO_DATE_RE.exec(isoDay(iso));
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** 0 is Sunday, 6 is Saturday, for a YYYY-MM-DD calendar date. */
export function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDay(isoDate).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDay(isoDate).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
