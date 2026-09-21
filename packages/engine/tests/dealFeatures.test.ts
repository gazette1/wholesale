import { describe, it, expect } from "vitest";
import { runDeal, outputsForStorage, ENGINE_VERSION, dealOffers, comparableAverage, sellerScore, loanAnalysis, resolveRehab, repairOverrideFor, validateDeal, quickOffers, GLOSSARY, GLOSSARY_SECTIONS, DealInputSchema, type DealInput, type RehabLine } from "../src";

const line = (row: number, patch: Partial<RehabLine> = {}): RehabLine => ({ row, itemNumber: null, question: null, option: `Item ${row}`, answer: "No", quantity: 1, unitCost: 1000, ...patch });

function baseDeal(): DealInput {
  return {
    meta: { name: "Base case" },
    rehab: { lines: [line(3, { answer: "Yes", unitCost: 6000 }), line(4), line(5, { answer: "Yes", unitCost: 2500, quantity: 2 })] },
    acquisitions: {
      holdMonths: 4, asIsValue: 150000, purchasePrice: 100000, arv: 200000, assignmentFee: -10000,
      firstLienAmount: 100000, firstPointsRate: 0.03, firstInterestRate: 0, firstMonthlyInterestOnlyRate: 0.14 / 12,
      secondLienAmount: 0, secondPointsRate: 0, secondInterestRate: 0, secondMonthlyInterestOnlyRate: 0,
      miscLienAmountPaid: 0, miscPointsPaid: 0, miscInterestPaid: 0, miscMonthlyInterestOnlyPaid: 0, miscFinancingCosts: 0,
      propertyTaxRate: 0.02, hoaMonthly: 0, insuranceMonthly: 100, utilitiesMonthly: 0, gasMonthly: 0, waterMonthly: 0, electricityMonthly: 0, miscUtilitiesMonthly: 0,
      miscHoldingMonthly: [0, 0, 0, 0], buyEscrowRate: 0.005, buyTitleRate: 0.01, buyMiscRate: 0, sellEscrowRate: 0.005, sellRecordingRate: 0.0025, sellRealtorRate: 0.03, sellTransferRate: 0.0001,
      sellHomeWarranty: 0, sellStaging: 0, sellMarketing: 0, sellMisc: 0,
    },
    wholesale: { arv: 200000, repairCosts: 0, assignmentFee: 10000, purchasePrice: 100000, investorBuyPrice: null, closingCosts: 1500, holdingCosts: 0, existingMortgagePayoff: 60000, sellerClosingCosts: 0 },
  };
}

describe("dealOffers", () => {
  const input = {
    enteredArv: 200000, comparables: [{ label: "A", value: 190000 }, { label: "B", value: 210000 }, { label: "C", value: 0 }], useComparableAverage: false,
    offerPercent: 0.7, assignmentFee: 10000, squareFeet: 1500, perSqft: { light: 15, medium: 30, full: 50 }, linkedRepairs: 11000,
  };

  it("builds three per foot tiers and the linked rehab offer", () => {
    const out = dealOffers(input);
    expect(out.allowance).toBeCloseTo(140000, 6);
    expect(out.lines.map((l) => l.offer)).toEqual([140000 - 10000 - 22500, 140000 - 10000 - 45000, 140000 - 10000 - 75000, 140000 - 10000 - 11000]);
    expect(out.lines[3]!.pctOfArv).toBeCloseTo(119000 / 200000, 9);
    expect(out.arvSource).toBe("entered");
  });

  it("ignores empty comparables and switches ARV when the average is on", () => {
    expect(comparableAverage(input.comparables)).toBe(200000);
    const out = dealOffers({ ...input, comparables: [{ label: "A", value: 180000 }, { label: "B", value: 190000 }], useComparableAverage: true });
    expect(out.arv).toBe(185000);
    expect(out.arvSource).toBe("comparables");
    expect(out.allowance).toBeCloseTo(129500, 6);
  });

  it("falls back to the entered ARV when the average is on with no comparables", () => {
    const out = dealOffers({ ...input, comparables: [], useComparableAverage: true });
    expect(out.arv).toBe(200000);
    expect(out.comparableAverage).toBeNull();
  });

  it("keeps a negative offer visible and treats a negative fee as its size", () => {
    const out = dealOffers({ ...input, enteredArv: 50000, assignmentFee: -10000 });
    expect(out.fee).toBe(10000);
    expect(out.lines[2]!.offer).toBe(35000 - 10000 - 75000);
  });

  it("matches the Quick Offers sheet rule for the same numbers", () => {
    const sheet = quickOffers({
      comps: [200000, 200000, 200000], squareFeet: 1500, assignmentFee: { full: -10000, medium: -10000, light: -10000 }, costPerSqft: { full: 50, medium: 30, light: 15 },
      valueWant: { probabilityOfSale: 0.5, timeMonths: 3, effort: 2 }, valueAre: { probabilityOfSale: 0.9, timeMonths: 1, effort: 1 },
    });
    const out = dealOffers(input);
    expect(out.lines[0]!.offer).toBeCloseTo(sheet.light.offer, 6);
    expect(out.lines[1]!.offer).toBeCloseTo(sheet.medium.offer, 6);
    expect(out.lines[2]!.offer).toBeCloseTo(sheet.full.offer, 6);
    expect(sellerScore({ outcome: 200000, probability: 0.5, months: 3, effort: 2 })).toBeCloseTo(sheet.valueWant, 6);
  });

  it("scores the seller cases and returns null when months or effort is zero", () => {
    const out = dealOffers({ ...input, sellerCurrent: { outcome: 120000, probability: 0.4, months: 6, effort: 3 }, sellerDesired: { outcome: 100000, probability: 0.95, months: 1, effort: 1 } });
    expect(out.sellerCurrentScore).toBeCloseTo((120000 * 0.4) / 18, 9);
    expect(out.sellerDesiredScore).toBeCloseTo(95000, 9);
    expect(out.sellerScoreDifference).toBeCloseTo(95000 - (120000 * 0.4) / 18, 9);
    expect(sellerScore({ outcome: 1, probability: 1, months: 0, effort: 1 })).toBeNull();
  });
});

describe("loanAnalysis", () => {
  it("matches the textbook payment for 200000 at 6 percent over 360 months", () => {
    const out = loanAnalysis({ principal: 200000, annualRate: 0.06, months: 360, firstPaymentDate: "2026-01-01" });
    expect(out.payment).toBeCloseTo(1199.1, 2);
    expect(out.rows).toHaveLength(360);
    expect(out.rows[0]!.interest).toBe(1000);
    expect(out.rows[0]!.principal).toBeCloseTo(199.1, 2);
    expect(out.rows[359]!.ending).toBe(0);
    expect(out.rows[359]!.cumulativePrincipal).toBeCloseTo(200000, 2);
    expect(out.totalInterest).toBeGreaterThan(231000);
    expect(out.totalInterest).toBeLessThan(232000);
  });

  it("handles a zero rate, month end dates, and the payoff lookup", () => {
    const out = loanAnalysis({ principal: 12000, annualRate: 0, months: 12, firstPaymentDate: "2026-01-31", payoffAfterPayment: 6 });
    expect(out.payment).toBe(1000);
    expect(out.totalInterest).toBe(0);
    expect(out.rows[1]!.date).toBe("2026-02-28");
    expect(out.rows[2]!.date).toBe("2026-03-31");
    expect(out.payoffBalance).toBe(6000);
    expect(out.payoffDate).toBe("2026-06-30");
  });

  it("clamps the payoff number and rejects terms outside 1 to 600", () => {
    expect(loanAnalysis({ principal: 1000, annualRate: 0.1, months: 3, firstPaymentDate: "2026-01-01", payoffAfterPayment: 99 }).payoffAfterPayment).toBe(3);
    expect(() => loanAnalysis({ principal: 1000, annualRate: 0.1, months: 0, firstPaymentDate: "2026-01-01" })).toThrow(/between 1 and 600/);
    expect(() => loanAnalysis({ principal: 1000, annualRate: 0.1, months: 601, firstPaymentDate: "2026-01-01" })).toThrow(/between 1 and 600/);
    expect(() => loanAnalysis({ principal: 0, annualRate: 0.1, months: 12, firstPaymentDate: "2026-01-01" })).toThrow(/greater than zero/);
  });
});

describe("resolveRehab", () => {
  const rehab = { lines: [line(3, { answer: "Yes", unitCost: 6000, status: "done" }), line(4), line(5, { answer: "Yes", unitCost: 2500, quantity: 2 }), line(6, { answer: "Yes", unitCost: null })] };

  it("uses the checklist by default and the override when one is set with no plan", () => {
    const c = resolveRehab(rehab, undefined, null);
    expect(c.source).toBe("checklist");
    expect(c.estimate).toBe(11000);
    expect(repairOverrideFor(c)).toBeNull();
    const m = resolveRehab(rehab, undefined, 25000);
    expect(m.source).toBe("manual");
    expect(repairOverrideFor(m)).toBe(25000);
  });

  it("supports the per square foot source and an explicit checklist source that ignores a stale override", () => {
    const p = resolveRehab(rehab, { source: "perSqft", perSqftRate: 30, squareFeet: 1500 }, 25000);
    expect(p.estimate).toBe(45000);
    expect(resolveRehab(rehab, { source: "checklist" }, 25000).estimate).toBe(11000);
  });

  it("counts completion on finished items only and flags items missing a price", () => {
    const c = resolveRehab(rehab, undefined, null);
    expect(c.includedCount).toBe(3);
    expect(c.completedCount).toBe(1);
    expect(c.completion).toBeCloseTo(1 / 3, 9);
    expect(c.incompleteCount).toBe(1);
  });
});

describe("validateDeal", () => {
  it("passes a sound deal with no errors", () => {
    expect(validateDeal(baseDeal()).filter((i) => i.level === "error")).toEqual([]);
  });

  it("reports the reference app's messages for bad inputs", () => {
    const d = baseDeal();
    d.acquisitions.arv = 0;
    d.acquisitions.arvFactor = 1.2;
    d.acquisitions.holdMonths = 12;
    d.offers = { comparables: [], useComparableAverage: true, squareFeet: 0, perSqft: { light: 15, medium: 30, full: 50 } };
    d.loan = { principal: 0, annualRate: 0.07, months: 360, firstPaymentDate: "2026-01-01" };
    d.buyAndHold = {
      salePrice: 100000, taxValue: 100000, units: [], propertyTaxYear: 1000, insuranceMonth: 100, gasElectricMonth: 0, waterMonth: 0, sewerMonth: 0, garbageMonth: 0, lawnSnowMonth: 0,
      managementPct: 0.5, vacancyPct: 0.3, maintenancePct: 0.3, cashReservesPct: 0, downPaymentPct: 0.2, interestRate: 0.07, loanTermYears: 30, closingCosts: 0,
      improvedValueRatio: 0.8, marginalTaxRate: 0.24, appreciationRate: 0.03, rentGrowthRate: 0.03, dcrRequired: 1.25,
    };
    const messages = validateDeal(d).map((i) => i.message);
    expect(messages).toContain("Enter a positive after repair value.");
    expect(messages).toContain("Enter an offer percentage between 0 and 100.");
    expect(messages).toContain("Add comparable sale values.");
    expect(messages).toContain("Add at least one rental unit.");
    expect(messages).toContain("Combined percentage expenses exceed 100% of rent.");
    expect(messages).toContain("Principal must be greater than zero.");
    expect(messages.some((m) => m.includes("runs past the workbook cash flow grid"))).toBe(true);
  });

  it("warns when the seller nets less than zero and when loans exceed purchase plus rehab", () => {
    const d = baseDeal();
    d.wholesale!.existingMortgagePayoff = 140000;
    d.acquisitions.firstLienAmount = 150000;
    const warns = validateDeal(d).filter((i) => i.level === "warn").map((i) => i.message);
    expect(warns.some((m) => m.includes("seller nets less than zero"))).toBe(true);
    expect(warns.some((m) => m.includes("Combined loan amounts exceed"))).toBe(true);
  });
});

describe("schema and glossary", () => {
  it("accepts inputs saved before the new optional blocks existed, and inputs that carry them", () => {
    expect(DealInputSchema.safeParse(baseDeal()).success).toBe(true);
    const d = baseDeal();
    d.meta.strategy = "flip";
    d.offers = { comparables: [{ label: "12 Oak", value: 205000 }], useComparableAverage: true, squareFeet: 1400, perSqft: { light: 15, medium: 30, full: 50 }, sellerCurrent: null };
    d.rehabPlan = { source: "perSqft", perSqftRate: 28, squareFeet: 1400 };
    d.progress = [{ date: "2026-09-21", message: "Roof tear off started" }];
    d.loan = { principal: 80000, annualRate: 0.075, months: 360, firstPaymentDate: "2026-11-01", payoffAfterPayment: 60 };
    d.rehab.lines[0] = { ...d.rehab.lines[0]!, status: "in_progress", notes: "Waiting on permit", custom: true };
    const parsed = DealInputSchema.safeParse(d);
    expect(parsed.success).toBe(true);
  });

  it("carries the 60 workbook definitions in eight sections with traceable cells", () => {
    expect(GLOSSARY).toHaveLength(60);
    expect(GLOSSARY_SECTIONS).toHaveLength(8);
    expect(GLOSSARY.every((g) => /^Definitions C\d+$/.test(g.source) && g.definition.length > 0)).toBe(true);
    expect(GLOSSARY_SECTIONS).toContain("Selling Transaction Costs");
  });
});

describe("runDeal", () => {
  it("runs a legacy input and keeps the checklist linked", () => {
    const out = runDeal(baseDeal(), { sensitivity: true });
    expect(out.engineVersion).toBe(ENGINE_VERSION);
    expect(out.rehabPlan.source).toBe("checklist");
    expect(out.acquisitions.repairCosts).toBe(11000);
    expect(out.wholesale.maxAllowableOffer).toBeCloseTo(200000 * 0.7 - 11000 - 10000, 6);
    expect(out.offers.lines[3]!.offer).toBeCloseTo(out.wholesale.maxAllowableOffer, 6);
    expect(out.sensitivity!.cells).toHaveLength(5);
    expect(out.loan).toBeNull();
    expect(out.buyAndHold).toBeNull();
  });

  it("drives every calculator from the comparable average and the per foot rehab source", () => {
    const d = baseDeal();
    d.offers = { comparables: [{ label: "A", value: 220000 }, { label: "B", value: 240000 }], useComparableAverage: true, squareFeet: 1500, perSqft: { light: 15, medium: 30, full: 50 } };
    d.rehabPlan = { source: "perSqft", perSqftRate: 20, squareFeet: 1500 };
    const out = runDeal(d);
    expect(out.effectiveArv).toBe(230000);
    expect(out.acquisitions.repairCosts).toBe(30000);
    expect(out.acquisitions.repairCostsSource).toBe("override");
    expect(out.wholesale.maxAllowableOffer).toBeCloseTo(230000 * 0.7 - 30000 - 10000, 6);
    expect(out.rehab.total).toBe(11000);
  });

  it("reports a loan error without throwing and trims payment rows for storage", () => {
    const d = baseDeal();
    d.loan = { principal: 80000, annualRate: 0.075, months: 360, firstPaymentDate: "2026-11-01", payoffAfterPayment: 60 };
    const out = runDeal(d);
    expect(out.loan!.rows).toHaveLength(360);
    expect(out.loan!.payoffBalance).toBeGreaterThan(70000);
    expect(outputsForStorage(out).loan!.rows).toHaveLength(0);
    expect(outputsForStorage(out).loan!.payment).toBe(out.loan!.payment);
    d.loan = { ...d.loan, principal: 0 };
    const bad = runDeal(d);
    expect(bad.loan).toBeNull();
    expect(bad.loanError).toMatch(/greater than zero/);
  });
});
