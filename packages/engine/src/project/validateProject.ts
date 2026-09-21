import type { DealIssue } from "../validate";
import { parseIsoDate, toIsoDate } from "../money";
import type { ProjectModelInput } from "./schemas";
import { monthStarts, type ProjectContext } from "./types";

/** Last day of the hold: the start date moved forward by the hold months, day of month clamped. */
export function holdEndDate(startDate: string, holdMonths: number): string {
  const d = parseIsoDate(startDate);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthStarts(holdMonths), 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return toIsoDate(target);
}

const CENT = 0.005;

/** Wording follows the Mac app where it had a message for the same rule. */
export function validateProject(input: ProjectModelInput, ctx: ProjectContext): DealIssue[] {
  const issues: DealIssue[] = [];
  const add = (level: DealIssue["level"], message: string) => issues.push({ level, section: "project", message });

  const purchaseFunding = input.loans.reduce((a, l) => a + l.purchaseFunding, 0);
  const rehabFunding = input.loans.reduce((a, l) => a + l.rehabFunding, 0);
  if (purchaseFunding > ctx.purchasePrice + CENT) add("error", "Combined purchase funding exceeds the purchase price. Allocate rehab funding separately.");
  if (rehabFunding > ctx.rehabEstimate + CENT) add("error", "Combined rehab loan commitments exceed the rehab estimate.");

  for (const [label, fees] of [["Buying", input.buyingFees], ["Selling", input.sellingFees]] as const) {
    if (fees.some((f) => f.basis !== "fixed" && f.value > 1)) add("error", `${label} fees: a percent fee must be no more than 100.`);
  }

  const draws = input.drawMode === "upfront" ? input.upfrontDraws : input.delayedDraws;
  if (draws.reduce((a, d) => a + d.fundingPercent, 0) > 1 + 1e-9) add("error", "Draw funding shares cannot exceed 100%.");
  if (rehabFunding > 0 && draws.length === 0) add("warn", "Add at least one draw so the rehab funding is released.");

  const dated = input.useCustomRehabSchedule || input.customCashEvents.length > 0;
  if (dated && !input.startDate) add("error", "Enter a start date so dated expenses can be placed in the hold period.");
  if (input.startDate) {
    const start = input.startDate.slice(0, 10);
    const end = holdEndDate(start, ctx.holdMonths);
    const outside = (date: string) => date.slice(0, 10) < start || date.slice(0, 10) > end;
    if (input.useCustomRehabSchedule && input.rehabExpenseEvents.some((e) => outside(e.date))) add("error", "Rehab expense dates must fall within the hold period.");
    if (input.customCashEvents.some((e) => outside(e.date))) add("error", "Other project cash events must fall within the hold period.");
  }
  if (input.useCustomRehabSchedule) {
    const scheduled = input.rehabExpenseEvents.reduce((a, e) => a + e.amount, 0);
    if (Math.abs(scheduled - ctx.rehabEstimate) > CENT) add("error", "Scheduled rehab expenses must equal the linked rehab estimate.");
  }
  return issues;
}
