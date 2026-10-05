import { describe, it, expect } from "vitest";
import { runDeal, DealInputSchema, emptyProjectModel, feeAmount, feeTotals, holdingLines, projectFinancing, projectRentalContext, round2, runProject, validateProject, holdEndDate, monthStarts, buildProjectTimeline, projectCashFlow, rehabSpendByWeek, rentalProjection, PROJECT_MODEL_VERSION, type DealInput, type ProjectContext, type ProjectModelInput, type ProjectRentalContext, type ProjectTimeline } from "../src";
import { acquisitionsInputFromFixture } from "./helpers";

const ctx: ProjectContext = { purchasePrice: 100000, asIsValue: 120000, salePrice: 200000, holdMonths: 6, rehabEstimate: 40000 };

const model = (patch: Partial<ProjectModelInput> = {}): ProjectModelInput => ({ ...emptyProjectModel(), ...patch });

function workbookDeal(): DealInput {
  return { meta: { name: "Golden" }, rehab: { lines: [] }, acquisitions: acquisitionsInputFromFixture() as DealInput["acquisitions"] };
}

describe("project model is inert for the workbook calculators", () => {
  it("leaves every workbook output identical when the project model is switched on", () => {
    const base = workbookDeal();
    const withProject: DealInput = {
      ...base,
      project: model({
        loans: [{ name: "Hard money", purchaseFunding: 80000, rehabFunding: 40000, annualRate: 0.12, points: 0.02, fixedFees: 1500, interestBasis: "fullCommitment" }],
        buyingFees: [{ name: "Title", value: 0.01, basis: "pctPurchase" }], sellingFees: [{ name: "Agent", value: 0.05, basis: "pctSale" }], holdingCosts: [{ name: "Insurance", amount: 150 }],
      }),
    };
    const off = runDeal(base);
    const on = runDeal(withProject);
    expect(on.acquisitions).toEqual(off.acquisitions);
    expect(on.wholesale).toEqual(off.wholesale);
    expect(on.offers).toEqual(off.offers);
    expect(off.project).toBeNull();
    expect(on.project).not.toBeNull();
  });

  it("is optional in the schema and accepted when present", () => {
    const base = workbookDeal();
    expect(DealInputSchema.safeParse(base).success).toBe(true);
    expect(DealInputSchema.safeParse({ ...base, project: emptyProjectModel() }).success).toBe(true);
    expect(DealInputSchema.safeParse({ ...base, project: { ...emptyProjectModel(), drawMode: "sometimes" } }).success).toBe(false);
  });
});

describe("fee items", () => {
  it("prices each basis from its own figure", () => {
    expect(feeAmount({ name: "Doc prep", value: 450, basis: "fixed" }, ctx)).toBe(450);
    expect(feeAmount({ name: "Title", value: 0.01, basis: "pctPurchase" }, ctx)).toBe(1000);
    expect(feeAmount({ name: "Agent", value: 0.05, basis: "pctSale" }, ctx)).toBe(10000);
    expect(feeAmount({ name: "Transfer", value: 0.005, basis: "pctAsIs" }, ctx)).toBe(600);
  });

  it("totals the lines", () => {
    const out = feeTotals([{ name: "A", value: 450, basis: "fixed" }, { name: "B", value: 0.01, basis: "pctPurchase" }], ctx);
    expect(out.total).toBe(1450);
    expect(out.lines.map((l) => l.amount)).toEqual([450, 1000]);
  });
});

describe("holding lines", () => {
  it("charges each line at every month start of the hold", () => {
    const out = holdingLines([{ name: "Insurance", amount: 150 }, { name: "Lawn", amount: 80 }], 6);
    expect(out.months).toBe(6);
    expect(out.total).toBe(1380);
  });

  it("charges the flip for the hold months, as the Mac flip result does", () => {
    // Mac FlipResult: holding = monthly holding x hold months. 100 x 4.5 = 450.
    expect(holdingLines([{ name: "Insurance", amount: 100 }], 4.5).total).toBe(450);
    // The weekly cash flow still books one holding event per month start, so a part month counts as a month start there.
    expect(monthStarts(4.5)).toBe(5);
    expect(monthStarts(0)).toBe(0);
  });
});

describe("project financing", () => {
  it("charges points on the commitment and monthly interest on a full commitment loan", () => {
    const out = projectFinancing([{ name: "Hard money", purchaseFunding: 80000, rehabFunding: 40000, annualRate: 0.12, points: 0.02, fixedFees: 1500, interestBasis: "fullCommitment" }], ctx);
    expect(out.loans[0]!.commitment).toBe(120000);
    expect(out.loans[0]!.pointsPaid).toBe(2400);
    expect(out.interest).toBeCloseTo(7200, 6);
    expect(out.total).toBeCloseTo(11100, 6);
    expect(out.ownerCashAtPurchase).toBe(20000);
  });

  it("is all cash with no loans", () => {
    const out = projectFinancing([], ctx);
    expect(out.allCash).toBe(true);
    expect(out.total).toBe(0);
    expect(out.ownerCashAtPurchase).toBe(100000);
  });

  it("reports a drawn balance loan as pending instead of guessing its interest", () => {
    const out = projectFinancing([{ name: "Draw loan", purchaseFunding: 80000, rehabFunding: 40000, annualRate: 0.12, points: 0.02, fixedFees: 0, interestBasis: "drawnBalance" }], ctx);
    expect(out.interest).toBeNull();
    expect(out.total).toBeNull();
    expect(out.pendingLoans).toEqual(["Draw loan"]);
  });
});

describe("runProject", () => {
  it("builds the flip lines and returns from the computed modules", () => {
    const out = runProject(model({
      loans: [{ name: "Hard money", purchaseFunding: 80000, rehabFunding: 40000, annualRate: 0.12, points: 0.02, fixedFees: 1500, interestBasis: "fullCommitment" }],
      buyingFees: [{ name: "Title", value: 0.01, basis: "pctPurchase" }], sellingFees: [{ name: "Agent", value: 0.05, basis: "pctSale" }], holdingCosts: [{ name: "Insurance", amount: 150 }],
      customCashEvents: [{ name: "Scrap metal", date: "2026-10-01", amount: 500 }],
    }), ctx);
    // 100000 + 1000 + 40000 + 900 + 11100 + 10000
    expect(out.flip.totalProjectCosts).toBeCloseTo(163000, 6);
    expect(out.flip.netProfit).toBeCloseTo(37500, 6);
    expect(out.flip.costRoi).toBeCloseTo(37500 / 163000, 9);
    expect(out.flip.purchaseRepairRoi).toBeCloseTo(37500 / 140000, 9);
    expect(out.flip.cashRoi).toBeNull();
    expect(out.cashFlow.status).toBe("pending");
    expect(out.pending.map((p) => p.module)).toEqual(["cashFlow", "cashRoi"]);
  });

  it("holds back net profit while any financing figure is pending", () => {
    const out = runProject(model({ loans: [{ name: "Draw loan", purchaseFunding: 80000, rehabFunding: 0, annualRate: 0.1, points: 0, fixedFees: 0, interestBasis: "drawnBalance" }] }), ctx);
    expect(out.flip.netProfit).toBeNull();
    expect(out.flip.costRoi).toBeNull();
    expect(out.pending[0]!.module).toBe("financing");
  });

  it("lists the projection as pending only when it is asked for", () => {
    expect(runProject(model(), ctx).rentalProjection).toBeNull();
    const out = runProject(model({ rentalProjection: { years: 20, ownerFundedRehab: 0, depreciableBasis: 150000, depreciationYears: 27.5, marginalTaxRate: 0.24 } }), ctx);
    expect(out.rentalProjection?.status).toBe("pending");
    expect(out.pending.some((p) => p.module === "rentalProjection")).toBe(true);
  });
});

describe("validateProject", () => {
  const messages = (input: ProjectModelInput) => validateProject(input, ctx).map((i) => i.message);

  it("passes an empty model", () => {
    expect(validateProject(model(), ctx)).toEqual([]);
  });

  it("checks loan funding against the purchase price and the rehab estimate", () => {
    const loan = { name: "A", annualRate: 0.1, points: 0, fixedFees: 0, interestBasis: "fullCommitment" as const };
    const out = messages(model({ loans: [{ ...loan, purchaseFunding: 100001, rehabFunding: 40001 }], delayedDraws: [{ timingPercent: 0.5, fundingPercent: 1 }] }));
    expect(out).toContain("Combined purchase funding exceeds the purchase price. Allocate rehab funding separately.");
    expect(out).toContain("Combined rehab loan commitments exceed the rehab estimate.");
  });

  it("caps draw funding shares at 100 percent for the draw mode in use", () => {
    const over = [{ timingPercent: 0.25, fundingPercent: 0.6 }, { timingPercent: 0.75, fundingPercent: 0.5 }];
    expect(messages(model({ drawMode: "delayed", delayedDraws: over }))).toContain("Draw funding shares cannot exceed 100%.");
    expect(messages(model({ drawMode: "upfront", delayedDraws: over }))).not.toContain("Draw funding shares cannot exceed 100%.");
  });

  it("keeps dated rehab expenses inside the hold and equal to the estimate", () => {
    expect(holdEndDate("2026-08-31", 6)).toBe("2027-02-28");
    const out = messages(model({ startDate: "2026-10-01", useCustomRehabSchedule: true, rehabExpenseEvents: [{ date: "2026-10-15", amount: 30000 }, { date: "2027-06-01", amount: 5000 }] }));
    expect(out).toContain("Rehab expense dates must fall within the hold period.");
    expect(out).toContain("Scheduled rehab expenses must equal the linked rehab estimate.");
    expect(messages(model({ startDate: "2026-10-01", useCustomRehabSchedule: true, rehabExpenseEvents: [{ date: "2026-10-15", amount: 40000 }] }))).toEqual([]);
  });

  it("keeps other cash events inside the hold and asks for a start date when one is needed", () => {
    expect(messages(model({ startDate: "2026-10-01", customCashEvents: [{ name: "Late", date: "2028-01-01", amount: -100 }] }))).toContain("Other project cash events must fall within the hold period.");
    expect(messages(model({ customCashEvents: [{ name: "Undated start", date: "2026-10-05", amount: -100 }] }))).toContain("Enter a start date so dated expenses can be placed in the hold period.");
  });

  it("reaches the deal issue list under the project section", () => {
    const deal = { ...workbookDeal(), project: model({ delayedDraws: [{ timingPercent: 0.5, fundingPercent: 1 }, { timingPercent: 0.9, fundingPercent: 0.5 }] }) };
    expect(runDeal(deal).issues.filter((i) => i.section === "project").map((i) => i.message)).toEqual(["Draw funding shares cannot exceed 100%."]);
  });
});

// Every dated test below starts on 2026-10-01 and holds 6 months, so the exit is 2027-04-01.
// Days from 2026-10-01: Nov 1 = 31, Dec 1 = 61, Jan 1 = 92, Feb 1 = 123, Mar 1 = 151, Apr 1 = 182.
// Weeks = ceil(182 / 7) = 26, as the Mac app computes it. Week k is dated 2026-10-01 plus 7 * (k - 1) days.
// Week 26 starts 2027-03-25; exit date events land in it because the last week runs through the exit date.
// Month starts land in weeks floor(days / 7) + 1: 1, 5, 9, 14, 18, 22.
const START = "2026-10-01";
const THREE_DRAWS = [{ timingPercent: 0.25, fundingPercent: 0.5 }, { timingPercent: 0.5, fundingPercent: 0.3 }, { timingPercent: 0.75, fundingPercent: 0.2 }];
const timelineOf = (patch: Partial<ProjectModelInput> = {}, c: ProjectContext = ctx): ProjectTimeline => {
  const built = buildProjectTimeline(model({ startDate: START, ...patch }), c);
  if (built.status !== "computed") throw new Error(built.reason);
  return built.value;
};

describe("weekly project cash flow", () => {
  it("dates every week from the start date and puts each month start in the week that contains it", () => {
    const t = timelineOf();
    expect(t.weekCount).toBe(26);
    expect(t.weekDates[25]).toBe("2027-03-25");
    expect(t.exitDate).toBe("2027-04-01");
    expect(t.weekDates[0]).toBe("2026-10-01");
    // Week 5 is 2026-10-01 plus 28 days. 2026-11-01 is 31 days out, so it falls inside week 5.
    expect(t.weekDates[4]).toBe("2026-10-29");
    expect(t.monthStartDates).toEqual(["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"]);
    expect(t.monthStartWeeks).toEqual([1, 5, 9, 14, 18, 22]);
  });

  it("puts a draw at a percent of the hold rounded up to a week", () => {
    const loan = { name: "Rehab loan", purchaseFunding: 0, rehabFunding: 40000, annualRate: 0.12, points: 0, fixedFees: 0, interestBasis: "fullCommitment" as const };
    const t = timelineOf({ loans: [loan], delayedDraws: THREE_DRAWS });
    // ceil(0.25 * 26) = ceil(6.5) = week 7, ceil(0.5 * 26) = week 13, ceil(0.75 * 26) = ceil(19.5) = week 20.
    expect(t.draws.map((d) => d.week)).toEqual([7, 13, 20]);
    // Week 7 is +42 days (2026-11-12), week 13 is +84 (2026-12-24), week 20 is +133 (2027-02-11).
    expect(t.draws.map((d) => d.date)).toEqual(["2026-11-12", "2026-12-24", "2027-02-11"]);
    // 40000 * 0.5, * 0.3, and the last tranche takes 40000 - 32000.
    expect(t.draws.map((d) => d.total)).toEqual([20000, 12000, 8000]);
    // 0 * 26 = 0 clamps up to the first week, 1 * 26 = 26 is the last.
    const edges = timelineOf({ loans: [loan], delayedDraws: [{ timingPercent: 0, fundingPercent: 0.5 }, { timingPercent: 1, fundingPercent: 0.5 }] });
    expect(edges.draws.map((d) => d.week)).toEqual([1, 26]);
  });

  it("never releases more than each loan's rehab funding", () => {
    const loan = { name: "Rehab loan", purchaseFunding: 0, rehabFunding: 40000, annualRate: 0.12, points: 0, fixedFees: 0, interestBasis: "fullCommitment" as const };
    // Three draws at 60% each ask for 72000 against a 40000 commitment: 24000, then 16000, then nothing.
    const t = timelineOf({ loans: [loan], delayedDraws: [0, 1, 2].map((i) => ({ timingPercent: 0.2 * (i + 1), fundingPercent: 0.6 })) });
    expect(t.draws.map((d) => d.total)).toEqual([24000, 16000, 0]);
    expect(t.rehabDrawnTotal).toEqual([40000]);
  });

  it("spreads the rehab evenly across the weeks and puts the cent adjustment in the final week", () => {
    const t = timelineOf();
    const spend = rehabSpendByWeek(model({ startDate: START }), ctx, t);
    // Mac rule: perWeek = round2(40000 / 26) = round2(1538.4615) = 1538.46 for weeks 1 to 25.
    // 1538.46 * 25 = 38461.50, so week 26 spends 40000 - 38461.50 = 1538.50.
    expect(spend).toHaveLength(26);
    expect(spend[0]).toBe(1538.46);
    expect(spend[24]).toBe(1538.46);
    expect(spend[25]).toBe(1538.5);
    expect(Math.round(spend.reduce((a, b) => a + b, 0) * 100)).toBe(4000000);
  });

  it("places a custom rehab schedule in the week that contains each date", () => {
    const t = timelineOf();
    const input = model({ startDate: START, useCustomRehabSchedule: true, rehabExpenseEvents: [{ date: "2026-10-15", amount: 25000 }, { date: "2027-03-30", amount: 15000 }] });
    const spend = rehabSpendByWeek(input, ctx, t);
    // 2026-10-15 is 14 days out: floor(14 / 7) + 1 = week 3. 2027-03-30 is 180 days out: floor(180 / 7) + 1 = week 26.
    expect(spend[2]).toBe(25000);
    expect(spend[25]).toBe(15000);
    expect(spend.reduce((a, b) => a + b, 0)).toBe(40000);
  });

  it("charges interest on a drawn balance from the debt at each month start", () => {
    const loan = { name: "Draw loan", purchaseFunding: 80000, rehabFunding: 40000, annualRate: 0.12, points: 0, fixedFees: 0, interestBasis: "drawnBalance" as const };
    const t = timelineOf({ loans: [loan], delayedDraws: THREE_DRAWS });
    const out = projectFinancing([loan], ctx, t);
    // Draws land 2026-11-12 (20000), 2026-12-24 (12000), 2027-02-11 (8000). Rehab drawn at each month start:
    // 10-01: 0, 11-01: 0, 12-01: 20000, 01-01: 32000, 02-01: 32000, 03-01: 40000.
    expect(t.rehabDrawnAtMonthStart[0]).toEqual([0, 0, 20000, 32000, 32000, 40000]);
    // Debt is 80000 purchase funding plus the rehab drawn, times 0.12 / 12 = 1% a month:
    // 800 + 800 + 1000 + 1120 + 1120 + 1200 = 6040.
    expect(out.loans[0]!.interestByMonth).toEqual([800, 800, 1000, 1120, 1120, 1200]);
    expect(out.interest).toBeCloseTo(6040, 6);
    expect(out.total).toBeCloseTo(6040, 6);
    expect(out.pendingLoans).toEqual([]);
  });

  it("leaves a full commitment loan's interest at the figure it had before the drawn balance rule", () => {
    const loan = { name: "Hard money", purchaseFunding: 80000, rehabFunding: 40000, annualRate: 0.12, points: 0.02, fixedFees: 1500, interestBasis: "fullCommitment" as const };
    // The rule that was already shipped: commitment * annual rate / 12 * month starts = 120000 * 0.01 * 6 = 7200.
    const expected = (80000 + 40000) * (0.12 / 12) * monthStarts(ctx.holdMonths);
    expect(expected).toBe(7200);
    expect(projectFinancing([loan], ctx).loans[0]!.interest).toBe(expected);
    expect(projectFinancing([loan], ctx, timelineOf({ loans: [loan], delayedDraws: THREE_DRAWS })).loans[0]!.interest).toBe(expected);
  });

  it("treats the low point as additional owner cash and reconciles cash profit to the flip net profit", () => {
    const input = model({
      startDate: START, initialCash: 25000,
      loans: [{ name: "Hard money", purchaseFunding: 80000, rehabFunding: 40000, annualRate: 0.12, points: 0.02, fixedFees: 1500, interestBasis: "fullCommitment" }],
      buyingFees: [{ name: "Title", value: 0.01, basis: "pctPurchase" }], sellingFees: [{ name: "Agent", value: 0.05, basis: "pctSale" }], holdingCosts: [{ name: "Insurance", amount: 150 }],
      delayedDraws: THREE_DRAWS, customCashEvents: [{ name: "Scrap metal", date: "2026-10-15", amount: 500 }],
    });
    const out = projectCashFlow(input, ctx);
    if (out.status !== "computed") throw new Error(out.reason);
    const cf = out.value;
    expect(cf.weeks).toHaveLength(26);
    expect(cf.exitDate).toBe("2027-04-01");
    // Week 1 out: purchase 100000 + title 1000 + points 2400 + lender fees 1500 + rehab 1538.46 + insurance 150 + interest 1200 = 107788.46.
    // Week 1 in: the 80000 purchase loan. Balance 25000 + 80000 - 107788.46 = -2788.46.
    expect(cf.weeks[0]!.cashOut).toBeCloseTo(107788.46, 2);
    expect(cf.weeks[0]!.cashIn).toBe(80000);
    expect(cf.weeks[0]!.ending).toBeCloseTo(-2788.46, 2);
    // Low point is 2026-11-05 (week 6), the last rehab week before the first draw. In: 80000 + 500 scrap. Out: 104900 at close
    // + 6 * 1538.46 rehab = 9230.76 + two month starts at 1350 = 2700, so 116830.76. 25000 + 80500 - 116830.76 = -11330.76.
    expect(cf.weeks[5]!.ending).toBeCloseTo(-11330.76, 2);
    expect(cf.minimumBalance).toBeCloseTo(-11330.76, 2);
    expect(cf.additionalCashNeeded).toBeCloseTo(11330.76, 2);
    expect(cf.totalOwnerCashRequired).toBeCloseTo(36330.76, 2);
    // Week 26 holds the last rehab (1538.50 on 2027-03-25) and the exit events on 2027-04-01:
    // sale 200000 in, selling 10000 and principal repayment 120000 out. Ending 25000 + 37500 = 62500.
    expect(cf.weeks[25]!.ending).toBeCloseTo(62500, 2);
    // Every line carries the Mac app's event name and date.
    const on = (label: string) => cf.events.find((e) => e.label === label);
    expect(on("Purchase")).toEqual({ label: "Purchase", date: "2026-10-01", amount: -100000 });
    expect(on("Hard money · purchase funding")).toEqual({ label: "Hard money · purchase funding", date: "2026-10-01", amount: 80000 });
    expect(on("Hard money · points and fees")?.amount).toBeCloseTo(-3900, 6);
    expect(on("Hard money · rehab draw 1")).toEqual({ label: "Hard money · rehab draw 1", date: "2026-11-12", amount: 20000 });
    expect(on("Hard money · interest month 6")).toEqual({ label: "Hard money · interest month 6", date: "2027-03-01", amount: -1200 });
    expect(on("Holding costs · month 2")).toEqual({ label: "Holding costs · month 2", date: "2026-11-01", amount: -150 });
    expect(on("Rehab · week 26")).toEqual({ label: "Rehab · week 26", date: "2027-03-25", amount: -1538.5 });
    expect(on("Hard money · principal repayment")).toEqual({ label: "Hard money · principal repayment", date: "2027-04-01", amount: -120000 });
    expect(on("Sale proceeds")).toEqual({ label: "Sale proceeds", date: "2027-04-01", amount: 200000 });
    expect(cf.events.map((e) => e.date)).toEqual([...cf.events.map((e) => e.date)].sort());
    expect(cf.cashProfit).toBeCloseTo(37500, 2);
    expect(cf.interest).toBeCloseTo(7200, 6);
    expect(cf.pointsAndFees).toBeCloseTo(3900, 6);
    expect(cf.financingCosts).toBeCloseTo(11100, 6);
    expect(cf.reconciliation.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(cf.cashProfit, 2);

    const run = runProject(input, ctx);
    // 200000 sale - (100000 + 1000 + 40000 + 900 + 10000 + 11100) + 500 = 37500.
    expect(run.flip.netProfit).toBeCloseTo(37500, 6);
    expect(cf.cashProfit).toBeCloseTo(run.flip.netProfit!, 2);
    expect(run.flip.cashRoi).toBeCloseTo(37500 / 36330.76, 9);
    expect(run.pending).toEqual([]);
    expect(run.modelVersion).toBe("0.3.0-preview");
  });

  it("reconciles cash profit to net profit to the cent on a drawn balance loan too", () => {
    const input = model({
      startDate: START, initialCash: 0,
      loans: [{ name: "Draw loan", purchaseFunding: 80000, rehabFunding: 40000, annualRate: 0.12, points: 0.02, fixedFees: 1500, interestBasis: "drawnBalance" }],
      buyingFees: [{ name: "Title", value: 0.01, basis: "pctPurchase" }, { name: "Doc prep", value: 450, basis: "fixed" }],
      sellingFees: [{ name: "Agent", value: 0.05, basis: "pctSale" }], holdingCosts: [{ name: "Insurance", amount: 150 }, { name: "Lawn", amount: 80 }],
      delayedDraws: THREE_DRAWS, customCashEvents: [{ name: "Scrap metal", date: "2026-10-15", amount: 500 }, { name: "Permit", date: "2026-11-20", amount: -1250 }],
    });
    const run = runProject(input, ctx);
    if (run.cashFlow.status !== "computed") throw new Error(run.cashFlow.reason);
    // Interest 6040 from the month start debt, points 2400, lender fees 1500, so financing is 9940.
    expect(run.financing.interest).toBeCloseTo(6040, 6);
    expect(run.flip.financing).toBeCloseTo(9940, 6);
    // 200000 - (100000 + 1450 + 40000 + 1380 + 10000 + 9940) + (500 - 1250) = 36480 - 750 = 37480 - 750? See below.
    // Costs: purchase 100000, buying 1000 + 450 = 1450, rehab 40000, holding 230 * 6 = 1380, selling 10000, financing 9940 = 162770.
    // 200000 - 162770 - 750 = 36480.
    expect(run.flip.netProfit).toBeCloseTo(36480, 6);
    // Mac FlipResult: total costs add max(0, -other net). Other net is 500 - 1250 = -750, so 162770 + 750 = 163520.
    expect(run.flip.totalProjectCosts).toBeCloseTo(163520, 6);
    expect(run.flip.costRoi).toBeCloseTo(36480 / 163520, 9);
    expect(run.cashFlow.value.cashProfit).toBeCloseTo(36480, 2);
    expect(Math.abs(run.cashFlow.value.cashProfit - run.flip.netProfit!)).toBeLessThan(0.005);
    expect(run.cashFlow.value.reconciliation.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(36480, 2);
  });

  it("covers a hold of 120 months and asks for a shorter one past that", () => {
    const long: ProjectContext = { ...ctx, holdMonths: 120 };
    const t = timelineOf({}, long);
    expect(t.exitDate).toBe("2036-10-01");
    // 2026-10-01 to 2036-10-01 is 7 common years and 3 leap years: 365 * 7 + 366 * 3 = 3653 days.
    // Weeks = floor(3653 / 7) + 1 = 521 + 1 = 522. One month start a month gives 120 of them.
    expect(t.weekCount).toBe(522);
    expect(t.monthStartWeeks).toHaveLength(120);
    const flow = projectCashFlow(model({ startDate: START }), long);
    if (flow.status !== "computed") throw new Error(flow.reason);
    expect(flow.value.weeks).toHaveLength(522);
    // Week 522 is 7 * 521 = 3647 days out, which is 6 days short of the exit, so 2036-09-25.
    expect(flow.value.weeks[521]!.date).toBe("2036-09-25");
    const past = buildProjectTimeline(model({ startDate: START }), { ...ctx, holdMonths: 121 });
    expect(past.status).toBe("pending");
    expect(past.status === "pending" && past.reason).toContain("120 months");
  });

  it("reads the low point at each date, so a dip inside a week counts", () => {
    const flat: ProjectContext = { ...ctx, purchasePrice: 0, rehabEstimate: 0, salePrice: 0 };
    const input = model({ startDate: START, initialCash: 1000, customCashEvents: [{ name: "Deposit out", date: "2026-10-02", amount: -5000 }, { name: "Deposit back", date: "2026-10-05", amount: 5000 }] });
    const out = projectCashFlow(input, flat);
    if (out.status !== "computed") throw new Error(out.reason);
    // 1000 - 5000 = -4000 on 2026-10-02, back to 1000 on 2026-10-05. Both dates sit in week 1.
    expect(out.value.weeks[0]!.ending).toBe(1000);
    expect(out.value.weeks[0]!.minimumBalance).toBe(-4000);
    expect(out.value.minimumBalance).toBe(-4000);
    expect(out.value.additionalCashNeeded).toBe(4000);
    expect(out.value.weeks[0]!.cashIn).toBe(5000);
    expect(out.value.weeks[0]!.cashOut).toBe(5000);
  });

  it("rounds each draw and each month of interest to cents, and the last draw takes the leftover cents", () => {
    const loan = { name: "Draw loan", purchaseFunding: 0, rehabFunding: 10000, annualRate: 0.1, points: 0, fixedFees: 0, interestBasis: "drawnBalance" as const };
    // Default delayed tranches: a third each at 25, 50, 75 percent of the hold. round2(10000 / 3) = 3333.33 twice,
    // then the last tranche takes 10000 - 6666.66 = 3333.34.
    const t = timelineOf({ loans: [loan] });
    expect(t.draws.map((d) => d.total)).toEqual([3333.33, 3333.33, 3333.34]);
    expect(t.rehabDrawnTotal).toEqual([10000]);
    // Drawn at each month start: 0, 0, 3333.33, 6666.66, 6666.66, 10000. Monthly rate 0.1 / 12.
    // 3333.33 * 0.1 / 12 = 27.77775 -> 27.78. 6666.66 * 0.1 / 12 = 55.5555 -> 55.56. 10000 * 0.1 / 12 = 83.333 -> 83.33.
    const out = projectFinancing([loan], ctx, t);
    expect(out.loans[0]!.interestByMonth).toEqual([0, 0, 27.78, 55.56, 55.56, 83.33]);
    expect(out.interest).toBeCloseTo(222.23, 6);
    // Full commitment rounds each month too: round2(83.333) = 83.33, times 6 = 499.98, not 500.
    const full = projectFinancing([{ ...loan, interestBasis: "fullCommitment" }], ctx, t);
    expect(full.interest).toBeCloseTo(499.98, 6);
  });

  it("starts a new project model with the Mac app's default draw tranches", () => {
    const m = emptyProjectModel();
    expect(m.delayedDraws.map((d) => d.timingPercent)).toEqual([0.25, 0.5, 0.75]);
    expect(m.upfrontDraws.map((d) => d.timingPercent)).toEqual([0.01, 0.33, 0.66]);
    for (const list of [m.delayedDraws, m.upfrontDraws]) {
      expect(list[0]!.fundingPercent).toBeCloseTo(1 / 3, 12);
      expect(list.reduce((a, d) => a + d.fundingPercent, 0)).toBeCloseTo(1, 12);
    }
    // Up front timing 1 percent of 26 weeks is 0.26, which rounds up to week 1, the start date.
    expect(timelineOf({ drawMode: "upfront", loans: [{ name: "L", purchaseFunding: 0, rehabFunding: 9000, annualRate: 0.1, points: 0, fixedFees: 0, interestBasis: "fullCommitment" }] }).draws[0]!.date).toBe(START);
    expect(validateProject(m, ctx)).toEqual([]);
  });

  it("rounds to cents half away from zero", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(27.77775)).toBe(27.78);
    expect(round2(1538.4615)).toBe(1538.46);
  });

  it("says what it is waiting for instead of guessing when there is no start date", () => {
    const out = projectCashFlow(model(), ctx);
    expect(out.status).toBe("pending");
    expect(out.status === "pending" && out.reason).toContain("start date");
  });
});

describe("rental projection", () => {
  // 200000 property, 2000 a month of rent, 20% of rent in management, vacancy and maintenance, 500 a month fixed.
  const rental: ProjectRentalContext = {
    price: 200000, grossMonthlyRent: 2000, percentOfRentExpenses: 0.2, fixedMonthlyExpenses: 500,
    downPaymentPct: 0.25, closingCosts: 5000, interestRate: 0.06, loanTermYears: 30, appreciationRate: 0.03, rentGrowthRate: 0.02,
  };
  const assumptions = { years: 20, ownerFundedRehab: 10000, depreciableBasis: 150000, depreciationYears: 27.5, marginalTaxRate: 0.24 };
  const run = (a = assumptions, r: ProjectRentalContext | null = rental) => {
    const out = rentalProjection(a, r);
    if (out.status !== "computed") throw new Error(out.reason);
    return out.value;
  };

  it("keeps fixed dollar operating expenses flat and grows the percent expenses with the rent", () => {
    const [y1, y2, y3] = run().years;
    // Year 1 rent 2000 * 12 = 24000. Percent expenses 24000 * 0.2 = 4800. Fixed 500 * 12 = 6000. Total 10800.
    expect(y1!.rent).toBeCloseTo(24000, 6);
    expect(y1!.operatingExpenses).toBeCloseTo(10800, 6);
    expect(y1!.noi).toBeCloseTo(13200, 6);
    // Year 2 rent 24000 * 1.02 = 24480. Percent 4896. Fixed stays 6000. Total 10896, so expenses rise by 96, not by 216.
    expect(y2!.rent).toBeCloseTo(24480, 6);
    expect(y2!.operatingExpenses).toBeCloseTo(10896, 6);
    expect(y2!.operatingExpenses - y1!.operatingExpenses).toBeCloseTo(96, 6);
    // Year 3 rent 24000 * 1.02^2 = 24969.6. Percent 4993.92. Total 10993.92.
    expect(y3!.operatingExpenses).toBeCloseTo(10993.92, 6);
  });

  it("keeps depreciation and tax savings outside operating cash flow and tracks cumulative return on the owner's cash", () => {
    const out = run();
    // Denominator: down payment 0.25 * 200000 = 50000, plus 5000 closing, plus 10000 owner funded rehab = 65000.
    expect(out.downPayment).toBe(50000);
    expect(out.initialCash).toBe(65000);
    expect(out.principal).toBe(150000);
    const [y1, y2] = out.years;
    // Depreciation is 150000 / 27.5 = 5454.545454... a year.
    expect(y1!.depreciation).toBeCloseTo(150000 / 27.5, 9);
    // Cash flow is NOI less debt service only. The tax savings are added later, in the annual total.
    expect(y1!.cashFlow).toBeCloseTo(y1!.noi - y1!.debtService, 9);
    expect(y1!.debtService).toBeCloseTo(out.monthlyPayment * 12, 9);
    // Tax savings are the marginal rate on depreciation plus the year's interest.
    expect(y1!.taxSavings).toBeCloseTo((y1!.depreciation + y1!.interest) * 0.24, 9);
    // Paydown is the part of debt service that is not interest.
    expect(y1!.paydown).toBeCloseTo(y1!.debtService - y1!.interest, 9);
    // Appreciation year 1 is 200000 * 0.03 = 6000, year 2 is 206000 * 0.03 = 6180.
    expect(y1!.appreciation).toBeCloseTo(6000, 6);
    expect(y1!.propertyValue).toBeCloseTo(206000, 6);
    expect(y2!.appreciation).toBeCloseTo(6180, 6);
    expect(y1!.annualTotal).toBeCloseTo(y1!.cashFlow + y1!.paydown + y1!.appreciation + y1!.taxSavings, 9);
    expect(y1!.annualRoi).toBeCloseTo(y1!.annualTotal / 65000, 9);
    expect(y2!.cumulativeTotal).toBeCloseTo(y1!.annualTotal + y2!.annualTotal, 6);
    expect(y2!.cumulativeRoi).toBeCloseTo((y1!.annualTotal + y2!.annualTotal) / 65000, 9);
    expect(out.years).toHaveLength(20);
  });

  it("stops the depreciation deduction when the basis runs out", () => {
    // 10000 over 3 years is 3333.333... a year, so years 1 to 3 take it and year 4 takes nothing.
    const out = run({ ...assumptions, years: 4, depreciableBasis: 10000, depreciationYears: 3 });
    expect(out.years.map((y) => Math.round(y.depreciation * 100) / 100)).toEqual([3333.33, 3333.33, 3333.33, 0]);
    expect(out.years.reduce((a, y) => a + y.depreciation, 0)).toBeCloseTo(10000, 6);
  });

  it("counts cash reserves as a percent of rent, with vacancy, management and maintenance", () => {
    const bh = { salePrice: 200000, units: [{ unit: 1, beds: 3, baths: 1, rent: 1500, marketRent: 1800 }], managementPct: 0.08, vacancyPct: 0.05, maintenancePct: 0.05, cashReservesPct: 0.02,
      propertyTaxYear: 2400, insuranceMonth: 100, gasElectricMonth: 0, waterMonth: 50, sewerMonth: 0, garbageMonth: 0, lawnSnowMonth: 0,
      downPaymentPct: 0.25, closingCosts: 5000, interestRate: 0.06, loanTermYears: 30, appreciationRate: 0.03, rentGrowthRate: 0.02 };
    const r = projectRentalContext(bh as never)!;
    expect(r.percentOfRentExpenses).toBeCloseTo(0.2, 12);
    // Fixed: 2400 / 12 + 100 + 50 = 350 a month, the Mac's annualTax + 12 x (insurance + utilities + other), per month.
    expect(r.fixedMonthlyExpenses).toBeCloseTo(350, 9);
  });

  it("says it needs the buy and hold inputs instead of guessing a rent", () => {
    const out = rentalProjection(assumptions, null);
    expect(out.status).toBe("pending");
    expect(out.status === "pending" && out.reason).toContain("Buy and hold");
  });
});

describe("model version", () => {
  it("is stamped on every run", () => {
    expect(PROJECT_MODEL_VERSION).toBe("0.3.0-preview");
    expect(runProject(model(), ctx).modelVersion).toBe(PROJECT_MODEL_VERSION);
  });
});
