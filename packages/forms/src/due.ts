/** Due dates from due rules, computed in the form's IANA time zone. */
import type { Answers, DueRule } from "./definition";
import { addCalendarDays, isIsoDate, isoDay, weekdayOf } from "./values";

/** Day based due dates land at this local hour on the target day. */
export const DUE_HOUR_LOCAL = 17;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function localParts(instant: Date, timeZone: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) if (p.type !== "literal") parts[p.type] = Number(p.value);
  return { y: parts.year!, m: parts.month!, d: parts.day!, h: parts.hour! % 24, min: parts.minute!, s: parts.second! };
}

/** The calendar date, YYYY-MM-DD, of an instant in a time zone. */
export function localDate(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = localParts(new Date(instant), timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(instant / 1000) * 1000;
}

/** The instant of a local wall clock time on a calendar date in a time zone. */
export function zonedTime(isoDate: string, hour: number, timeZone: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, hour);
  let t = wall - zoneOffsetMs(wall, timeZone);
  t = wall - zoneOffsetMs(t, timeZone);
  return new Date(t);
}

/** Moves a calendar date by business days, skipping Saturday and Sunday. Negative counts move back. */
export function addBusinessDays(isoDate: string, days: number): string {
  let date = isoDay(isoDate);
  const step = days < 0 ? -1 : 1;
  let left = Math.abs(days);
  while (left > 0) {
    date = addCalendarDays(date, step);
    const wd = weekdayOf(date);
    if (wd !== 0 && wd !== 6) left--;
  }
  return date;
}

export type DueContext = {
  now: Date;
  timeZone: string;
  submissionStartedAt: Date;
  previousSectionCompletedAt?: Date | null;
  answers: Answers;
};

/**
 * The due instant for a rule, or null when its starting point is not known yet.
 * days and business_days land at 17:00 local time on the target day; hours add hours to the start.
 * A date_field start reads the answer's calendar date, and hours count from local midnight of that date.
 */
export function computeDueAt(rule: DueRule, ctx: DueContext): Date | null {
  let start: Date | null = null;
  let startDay: string | null = null;
  if (rule.from === "submission_start") start = ctx.submissionStartedAt;
  else if (rule.from === "previous_section") start = ctx.previousSectionCompletedAt ?? null;
  else {
    const v = rule.fieldKey ? ctx.answers[rule.fieldKey] : undefined;
    if (!isIsoDate(v, true)) return null;
    startDay = isoDay(v);
    start = zonedTime(startDay, 0, ctx.timeZone);
  }
  if (!start) return null;
  if (rule.unit === "hours") return new Date(start.getTime() + rule.offset * 3_600_000);
  const day = startDay ?? localDate(start, ctx.timeZone);
  const target = rule.unit === "days" ? addCalendarDays(day, rule.offset) : addBusinessDays(day, rule.offset);
  return zonedTime(target, DUE_HOUR_LOCAL, ctx.timeZone);
}
