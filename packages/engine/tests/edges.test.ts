import { describe, it, expect } from "vitest";
import { acquisitions, drawCashFlow, rehabEstimator, buyAndHold, wholesale, sensitivityGrid, scaled, pmt, cumipmt, roundUp, COST_COLUMNS } from "../src";
import { loadFixture, acquisitionsInputFromFixture, buyAndHoldInputFromFixture } from "./helpers";

describe("edge cases", () => {
  it("hold time 0 does not throw and warns", () => {
    const out = acquisitions({ ...acquisitionsInputFromFixture(), holdMonths: 0 });
    expect(Number.isFinite(out.netProfit)).toBe(true);
    expect(out.delayed.cashFlow.durationWeeks).toBe(0);
    expect(out.warnings.some((w) => w.includes("0 months"))).toBe(true);
    // No sale week exists, so the balance never receives the ARV.
    expect(out.delayed.cashFlow.weeks.every((w) => w.cashIn <= 200000)).toBe(true);
  });

  it("hold time 9 fills exactly 36 weeks and the sale lands on the last row", () => {
    const out = acquisitions({ ...acquisitionsInputFromFixture(), holdMonths: 9 });
    const flow = out.delayed.cashFlow;
    expect(flow.durationWeeks).toBe(36);
    expect(flow.weeks[35]!.cashIn).toBeGreaterThan(0);
    expect(flow.warnings.length).toBe(0);
    expect(Math.abs(flow.excessCash - out.netProfit)).toBeLessThan(0.01);
  });

  it("hold time 10 exceeds the grid and warns (A-07)", () => {
    const out = acquisitions({ ...acquisitionsInputFromFixture(), holdMonths: 10 });
    expect(out.delayed.cashFlow.warnings.some((w) => w.includes("A-07"))).toBe(true);
    expect(out.delayed.cashFlow.excessCash).toBeLessThan(0);
  });

  it("all liens zero gives zero financing and finite ROI", () => {
    const out = acquisitions({
      ...acquisitionsInputFromFixture(),
      firstLienAmount: 0, secondLienAmount: 0, miscLienAmountPaid: 0, miscPointsPaid: 0, miscInterestPaid: 0, miscMonthlyInterestOnlyPaid: 0, miscFinancingCosts: 0,
    });
    expect(out.financing.total).toBe(0);
    expect(out.cashInvested).toBeCloseTo(out.holding.total, 6);
    expect(Number.isFinite(out.roiOnCash)).toBe(true);
  });

  it("rehab with every item No totals zero", () => {
    const fx = loadFixture("rehab-estimator.json");
    const lines = fx.inputs.lines.map((l: any) => ({ ...l, answer: "No" }));
    expect(rehabEstimator({ lines }).total).toBe(0);
  });

  it("acquisitions links the rehab checklist and honors the override", () => {
    const fx = loadFixture("rehab-estimator.json");
    const base = acquisitionsInputFromFixture();
    delete (base as any).repairCosts;
    const linked = acquisitions({ ...base, rehab: { lines: fx.inputs.lines } });
    expect(linked.repairCosts).toBe(20050);
    expect(linked.repairCostsSource).toBe("rehab");
    const overridden = acquisitions({ ...base, rehab: { lines: fx.inputs.lines }, repairCostsOverride: 25000 });
    expect(overridden.repairCosts).toBe(25000);
    expect(overridden.repairCostsSource).toBe("override");
  });

  it("buy and hold with one unit", () => {
    const base = buyAndHoldInputFromFixture();
    const out = buyAndHold({ ...base, units: [{ unit: 1, beds: 3, baths: 2, rent: 1500, marketRent: 1800 }] });
    expect(out.totalRent).toBe(1500);
    expect(out.totalMarketRent).toBe(1800);
    expect(out.current.grossRents).toBe(1500);
    expect(Number.isFinite(out.dcr.proForma.dcr)).toBe(true);
    expect(out.rentGrowth.length).toBe(20);
  });

  it("fractional delayed draw week is dropped and flagged, rounding flag restores it (A-08)", () => {
    const base = { ...acquisitionsInputFromFixture(), holdMonths: 4.5 };
    const sheet = acquisitions(base);
    expect(sheet.delayed.cashFlow.drawWeeks[0]).toBe(4.5);
    expect(sheet.delayed.cashFlow.warnings.some((w) => w.includes("A-08"))).toBe(true);
    const fixed = acquisitions({ ...base, flags: { roundDelayedDrawWeeks: true } });
    expect(fixed.delayed.cashFlow.drawWeeks[0]).toBe(5);
  });

  it("week 11 construction bug only bites when the duration is 10 weeks (A-17)", () => {
    const zeroTotals = Object.fromEntries(COST_COLUMNS.map((k) => [k, 0])) as Record<(typeof COST_COLUMNS)[number], number>;
    const costTotals = { ...zeroTotals, constructionCosts: 10000 };
    const common = { schedule: "delayed" as const, maxWeeks: 36, holdMonths: 2.5, beginningCashBalance: 0, purchasePrice: 1, repairCosts: 10000, arv: 1, costTotals };
    const sheet = drawCashFlow(common);
    const fixed = drawCashFlow({ ...common, flags: { fixConstructionWeek11: true } });
    // The sheet places an eleventh week of cost for a 10 week duration; the fix does not.
    expect(sheet.columnTotals.constructionCosts).toBeCloseTo(11000, 6);
    expect(fixed.columnTotals.constructionCosts).toBeCloseTo(10000, 6);
  });

  it("transaction cost base flag changes buying and selling totals as documented (A-02)", () => {
    const out = acquisitions({ ...acquisitionsInputFromFixture(), flags: { fixTransactionCostBases: true } });
    expect(out.buying.total).toBeCloseTo(3000, 6);
    expect(out.selling.total).toBeCloseTo(11280, 6);
  });

  it("wholesale math", () => {
    const out = wholesale({ arv: 300000, repairCosts: 20050, assignmentFee: 10000, purchasePrice: 175000, closingCosts: 2000 });
    expect(out.maxAllowableOffer).toBeCloseTo(179950, 6);
    expect(out.investorBuyPrice).toBeCloseTo(189950, 6);
    expect(out.spread).toBeCloseTo(14950, 6);
    expect(out.netProfit).toBeCloseTo(12950, 6);
    expect(out.arvPct).toBeCloseTo(175000 / 300000, 9);
  });

  it("sensitivity grid runs and matches the base case at 1.0", () => {
    const base = acquisitionsInputFromFixture();
    const grid = sensitivityGrid(base, { key: "arv", values: scaled(base.arv, [0.9, 1, 1.1]) }, { key: "repairCosts", values: scaled(20050, [0.8, 1, 1.2]) });
    expect(grid.cells.length).toBe(3);
    expect(grid.cells[1]![1]!.netProfit).toBeCloseTo(acquisitions(base).netProfit, 6);
    expect(grid.cells[2]![0]!.netProfit).toBeGreaterThan(grid.cells[0]![2]!.netProfit);
  });

  it("money helpers agree with Excel", () => {
    expect(pmt(0.03 / 12, 60, -500000)).toBeCloseTo(8984.345332, 5);
    expect(-cumipmt(0.07 / 12, 360, 207900, 1, 12, 0)).toBeCloseTo(14486.09801, 4);
    expect(roundUp(5.28, 0)).toBe(6);
    expect(roundUp(0.16, 0)).toBe(1);
    expect(roundUp(4, 0)).toBe(4);
    expect(roundUp(16 * 0.25, 0)).toBe(4);
    expect(roundUp(-1.2, 0)).toBe(-2);
  });
});
