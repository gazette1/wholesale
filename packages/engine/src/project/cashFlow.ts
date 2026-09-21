import { addDays, parseIsoDate, roundUp, toIsoDate } from "../money";
import { feeTotals } from "./fees";
import { projectFinancing, type ProjectFinancingResult } from "./financing";
import type { ProjectModelInput } from "./schemas";
import { MAX_PROJECT_HOLD_MONTHS, monthStarts, pendingModule, type ModuleResult, type ProjectContext } from "./types";

export type CashWeek = { number: number; date: string; cashIn: number; cashOut: number; ending: number; minimumBalance: number };

export type ProjectCashFlowResult = {
  weeks: CashWeek[];
  exitDate: string;
  minimumBalance: number;
  /** A negative low point is cash the owner must add on top of the initial cash. */
  additionalCashNeeded: number;
  totalOwnerCashRequired: number;
  interest: number; pointsAndFees: number; financingCosts: number;
  cashProfit: number;
  /** Cash profit tied back to the flip net profit, line by line. The lines sum to cashProfit. */
  reconciliation: { label: string; amount: number }[];
};

export type ProjectDraw = {
  /** Week the draw lands on, 1 based. */
  week: number; date: string; timingPercent: number; fundingPercent: number;
  /** Released by this draw for each loan, in the order the loans are entered. */
  byLoan: number[];
  total: number;
};

/** The calendar skeleton every dated part of the project model shares. Built once per run. */
export type ProjectTimeline = {
  startDate: string; exitDate: string; weekCount: number;
  /** ISO date of each week row, week 1 first. */
  weekDates: string[];
  /** Week number of each month start, in order, one per month start of the hold. */
  monthStartWeeks: number[];
  monthStartDates: string[];
  draws: ProjectDraw[];
  /** Rehab drawn for each loan at each month start, loan first then month. Purchase funding is not in here. */
  rehabDrawnAtMonthStart: number[][];
  /** Rehab released across the whole hold, per loan. */
  rehabDrawnTotal: number[];
};

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_MS);

/** Move a calendar date forward whole months, clamping the day of month to the shorter month. */
export function addMonthsClamped(iso: string, months: number): string {
  const d = parseIsoDate(iso);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return toIsoDate(target);
}

export function buildProjectTimeline(input: ProjectModelInput, ctx: ProjectContext): ModuleResult<ProjectTimeline> {
  if (!input.startDate) return pendingModule("Enter a project start date. The weekly cash flow places every cost on a calendar date.");
  if (!(ctx.holdMonths >= 0) || !Number.isFinite(ctx.holdMonths)) return pendingModule("Enter a hold period so the weekly cash flow has a length.");
  if (ctx.holdMonths > MAX_PROJECT_HOLD_MONTHS) return pendingModule(`The weekly cash flow covers holds up to ${MAX_PROJECT_HOLD_MONTHS} months. This hold is ${ctx.holdMonths} months.`);

  const startDate = input.startDate.slice(0, 10);
  const months = monthStarts(ctx.holdMonths);
  const exitDate = addMonthsClamped(startDate, months);
  const weekCount = Math.floor(daysBetween(startDate, exitDate) / 7) + 1;
  const weekDates = Array.from({ length: weekCount }, (_, i) => toIsoDate(addDays(parseIsoDate(startDate), i * 7)));
  const monthStartDates = Array.from({ length: months }, (_, m) => addMonthsClamped(startDate, m));
  const clampWeek = (week: number) => Math.min(weekCount, Math.max(1, week));
  const weekOfDate = (iso: string) => clampWeek(Math.floor(daysBetween(startDate, iso.slice(0, 10)) / 7) + 1);
  const monthStartWeeks = monthStartDates.map(weekOfDate);

  const tranches = input.drawMode === "upfront" ? input.upfrontDraws : input.delayedDraws;
  const released = input.loans.map(() => 0);
  const draws: ProjectDraw[] = tranches.map((d) => {
    // Draw timing is a share of the hold rounded up to a whole week. A draw never releases more than the loan's rehab commitment.
    const week = clampWeek(roundUp(d.timingPercent * weekCount, 0));
    const byLoan = input.loans.map((l, i) => {
      const amount = Math.max(0, Math.min(l.rehabFunding * d.fundingPercent, l.rehabFunding - (released[i] ?? 0)));
      released[i] = (released[i] ?? 0) + amount;
      return amount;
    });
    return { week, date: weekDates[week - 1] as string, timingPercent: d.timingPercent, fundingPercent: d.fundingPercent, byLoan, total: byLoan.reduce((a, b) => a + b, 0) };
  });

  const rehabDrawnAtMonthStart = input.loans.map((_, i) =>
    monthStartDates.map((msDate) => draws.reduce((a, d) => (d.date <= msDate ? a + (d.byLoan[i] ?? 0) : a), 0)));

  return { status: "computed", value: { startDate, exitDate, weekCount, weekDates, monthStartWeeks, monthStartDates, draws, rehabDrawnAtMonthStart, rehabDrawnTotal: released } };
}

/**
 * Rehab spend by week. A custom schedule places each dated expense in the week that contains its date.
 * Otherwise the spend is even across every week, with the cent adjustment in the final week.
 */
export function rehabSpendByWeek(input: ProjectModelInput, ctx: ProjectContext, timeline: ProjectTimeline): number[] {
  const out = new Array<number>(timeline.weekCount).fill(0);
  if (input.useCustomRehabSchedule) {
    for (const e of input.rehabExpenseEvents) {
      const week = weekIndexFor(timeline, e.date);
      out[week] = (out[week] ?? 0) + e.amount;
    }
    return out;
  }
  const totalCents = Math.round(ctx.rehabEstimate * 100);
  const perWeekCents = Math.round(totalCents / timeline.weekCount);
  for (let i = 0; i < timeline.weekCount - 1; i++) out[i] = perWeekCents / 100;
  out[timeline.weekCount - 1] = (totalCents - perWeekCents * (timeline.weekCount - 1)) / 100;
  return out;
}

function weekIndexFor(timeline: ProjectTimeline, iso: string): number {
  const week = Math.floor(daysBetween(timeline.startDate, iso.slice(0, 10)) / 7) + 1;
  return Math.min(timeline.weekCount, Math.max(1, week)) - 1;
}

/**
 * Weekly construction cash flow on calendar dates, up to 120 months, with draw tranches, dated rehab
 * expenses, and other dated cash events. The rules are listed in docs/MAC_PARITY.md under "Project model".
 */
export function projectCashFlow(input: ProjectModelInput, ctx: ProjectContext, timeline?: ProjectTimeline, financing?: ProjectFinancingResult): ModuleResult<ProjectCashFlowResult> {
  let t = timeline;
  if (!t) {
    const built = buildProjectTimeline(input, ctx);
    if (built.status === "pending") return pendingModule(built.reason);
    t = built.value;
  }
  const fin = financing ?? projectFinancing(input.loans, ctx, t);
  if (fin.interest === null || fin.interestByMonth === null) return pendingModule("Loan interest is not calculated for these loans, so the weekly cash flow cannot be built.");

  const buying = feeTotals(input.buyingFees, ctx);
  const selling = feeTotals(input.sellingFees, ctx);
  const monthlyHolding = input.holdingCosts.reduce((a, c) => a + c.amount, 0);
  const holdingTotal = monthlyHolding * t.monthStartWeeks.length;
  const rehabByWeek = rehabSpendByWeek(input, ctx, t);
  const rehabPaid = rehabByWeek.reduce((a, b) => a + b, 0);
  const drawnTotal = t.rehabDrawnTotal.reduce((a, b) => a + b, 0);
  const otherNet = input.customCashEvents.reduce((a, e) => a + e.amount, 0);

  const cashIn = new Array<number>(t.weekCount).fill(0);
  const cashOut = new Array<number>(t.weekCount).fill(0);
  const addIn = (week: number, amount: number) => { if (amount) cashIn[week - 1] = (cashIn[week - 1] ?? 0) + amount; };
  const addOut = (week: number, amount: number) => { if (amount) cashOut[week - 1] = (cashOut[week - 1] ?? 0) + amount; };

  addIn(1, fin.totalPurchaseFunding);
  addOut(1, ctx.purchasePrice + buying.total + fin.pointsAndFees);
  for (const d of t.draws) addIn(d.week, d.total);
  rehabByWeek.forEach((amount, i) => addOut(i + 1, amount));
  t.monthStartWeeks.forEach((week, m) => { addOut(week, monthlyHolding); addOut(week, fin.interestByMonth?.[m] ?? 0); });
  addIn(t.weekCount, ctx.salePrice);
  addOut(t.weekCount, selling.total + fin.totalPurchaseFunding + drawnTotal);
  for (const e of input.customCashEvents) {
    const week = weekIndexFor(t, e.date) + 1;
    if (e.amount >= 0) addIn(week, e.amount); else addOut(week, -e.amount);
  }

  const initialCash = input.initialCash ?? 0;
  const weeks: CashWeek[] = [];
  let balance = initialCash;
  let low = initialCash;
  for (let i = 0; i < t.weekCount; i++) {
    balance = balance + (cashIn[i] ?? 0) - (cashOut[i] ?? 0);
    if (balance < low) low = balance;
    weeks.push({ number: i + 1, date: t.weekDates[i] as string, cashIn: cashIn[i] ?? 0, cashOut: cashOut[i] ?? 0, ending: balance, minimumBalance: low });
  }

  const additionalCashNeeded = Math.max(0, -low);
  const cashProfit = balance - initialCash;
  const reconciliation = [
    { label: "Sale proceeds", amount: ctx.salePrice },
    { label: "Purchase price", amount: -ctx.purchasePrice },
    { label: "Buying costs", amount: -buying.total },
    { label: "Rehab paid", amount: -rehabPaid },
    { label: "Holding costs", amount: -holdingTotal },
    { label: "Loan interest", amount: -fin.interest },
    { label: "Loan points and fees", amount: -fin.pointsAndFees },
    { label: "Selling costs", amount: -selling.total },
    { label: "Other income and expenses", amount: otherNet },
  ];

  return {
    status: "computed",
    value: {
      weeks, exitDate: t.exitDate, minimumBalance: low, additionalCashNeeded, totalOwnerCashRequired: initialCash + additionalCashNeeded,
      interest: fin.interest, pointsAndFees: fin.pointsAndFees, financingCosts: fin.interest + fin.pointsAndFees, cashProfit, reconciliation,
    },
  };
}
