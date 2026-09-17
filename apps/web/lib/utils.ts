import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNowStrict, format, isPast, isToday, isTomorrow } from "date-fns";

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

export function relative(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

export function shortDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return format(date, "MMM d, yyyy");
}

export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return format(date, "MMM d, h:mm a");
}

export function dueLabel(d: Date | string | null | undefined): { text: string; tone: "bad" | "warn" | "good" | "muted" } {
  if (!d) return { text: "No follow up", tone: "muted" };
  const date = typeof d === "string" ? new Date(d) : d;
  if (isToday(date)) return { text: "Due today", tone: "warn" };
  if (isPast(date)) return { text: `Overdue ${formatDistanceToNowStrict(date)}`, tone: "bad" };
  if (isTomorrow(date)) return { text: "Due tomorrow", tone: "good" };
  return { text: format(date, "MMM d"), tone: "muted" };
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
