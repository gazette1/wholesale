import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct2 = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US");

export function money(v: number | string | null | undefined, opts: { cents?: boolean } = {}): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "n/a";
  return opts.cents ? usd2.format(n) : usd.format(n);
}

export function percent(v: number | string | null | undefined, digits: 1 | 2 = 1): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "n/a";
  return digits === 2 ? pct2.format(n) : pct.format(n);
}

export function multiple(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return `${v.toFixed(2)}x`;
}

export function num(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  return int.format(Number(v));
}

/**
 * Every date in the app is shown in one business time zone, not the machine's. Server components run in UTC on
 * Vercel, and a follow up due at 9 PM Eastern would otherwise read as tomorrow. Set NEXT_PUBLIC_APP_TIMEZONE to change it.
 */
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "America/New_York";

function toDate(d: Date | string): Date { return typeof d === "string" ? new Date(d) : d; }
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
/** "2026-09-21" in the app time zone. */
export function dayKey(d: Date | string): string { return dayKeyFmt.format(toDate(d)); }
function dayDiff(d: Date): number {
  const a = Date.parse(`${dayKey(d)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(new Date())}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}
/** The instants where today starts and ends in the app time zone, whatever zone the server runs in. */
export function appDayBounds(ref: Date = new Date()): { start: Date; end: Date } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(ref).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offset = asUtc - Math.floor(ref.getTime() / 1000) * 1000;
  const start = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - offset);
  return { start, end: new Date(start.getTime() + 86_400_000 - 1) };
}

const shortFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, month: "short", day: "numeric", year: "numeric" });
const monthDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, hour: "numeric", minute: "2-digit" });

/** Coarse on purpose: nothing finer than a minute, so a server render and the browser agree. */
export function relative(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = toDate(d);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const future = seconds < 0;
  const abs = Math.abs(seconds);
  if (abs < 90) return future ? "in a moment" : "just now";
  const units: [number, string][] = [[3600, "minute"], [86_400, "hour"], [86_400 * 30, "day"], [86_400 * 365, "month"], [Infinity, "year"]];
  const sizes = [60, 3600, 86_400, 86_400 * 30, 86_400 * 365];
  let i = 0;
  while (abs >= units[i]![0]) i++;
  const n = Math.max(1, Math.floor(abs / sizes[i]!));
  const label = `${n} ${units[i]![1]}${n === 1 ? "" : "s"}`;
  return future ? `in ${label}` : `${label} ago`;
}

export function shortDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = toDate(d);
  return Number.isNaN(date.getTime()) ? "" : shortFmt.format(date);
}

export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = toDate(d);
  return Number.isNaN(date.getTime()) ? "" : `${monthDayFmt.format(date)}, ${timeFmt.format(date)}`;
}

export function timeOfDay(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = toDate(d);
  return Number.isNaN(date.getTime()) ? "" : timeFmt.format(date);
}

/** Due badge text. `at` carries the clock time so a 2:30 PM task can be told from a 9 AM one. */
export function dueLabel(d: Date | string | null | undefined): { text: string; tone: "bad" | "warn" | "good" | "muted"; at: string } {
  if (!d) return { text: "No follow up", tone: "muted", at: "" };
  const date = toDate(d);
  if (Number.isNaN(date.getTime())) return { text: "No follow up", tone: "muted", at: "" };
  const at = timeFmt.format(date);
  const diff = dayDiff(date);
  if (diff === 0) return { text: date.getTime() < Date.now() ? `Due today, was ${at}` : `Due today ${at}`, tone: "warn", at };
  if (diff < 0) return { text: `Overdue ${-diff} ${diff === -1 ? "day" : "days"}`, tone: "bad", at };
  if (diff === 1) return { text: `Due tomorrow ${at}`, tone: "good", at };
  return { text: `${monthDayFmt.format(date)}, ${at}`, tone: "muted", at };
}

export function fullName(p: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!p) return "";
  return [p.firstName, p.lastName].filter(Boolean).join(" ");
}

export function addressLine(p: { addressLine1: string; city: string; state: string; postalCode: string }): string {
  return `${p.addressLine1}, ${p.city}, ${p.state} ${p.postalCode}`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
}

export function toNumber(v: FormDataEntryValue | null | undefined, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

export function toOptionalNumber(v: FormDataEntryValue | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
