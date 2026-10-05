import { describe, it, expect } from "vitest";
import { compsArv, monthsBetween, DEFAULT_COMP_RATES, DEFAULT_COMP_SCORING, type CompInput, type CompsSubject } from "../src";

const AS_OF = "2026-09-21";
const subject: CompsSubject = { sqft: 1500, beds: 3, baths: 2, yearBuilt: 2000, lotSqft: null };

function comp(over: Partial<CompInput> = {}): CompInput {
  return { id: "a", label: "1 Oak", price: 200000, soldOn: AS_OF, sqft: 1500, beds: 3, baths: 2, yearBuilt: 2000, lotSqft: null, distanceMi: 0, included: true, manual: [], ...over };
}

describe("monthsBetween", () => {
  it("counts 30 day months", () => {
    // 2026-03-25 to 2026-09-21: 6 + 30 + 31 + 30 + 31 + 31 + 21 = 180 days. 180 / 30 = 6.
    expect(monthsBetween("2026-03-25", AS_OF)).toBeCloseTo(6, 6);
    expect(monthsBetween(null, AS_OF)).toBeNull();
    expect(monthsBetween("not a date", AS_OF)).toBeNull();
  });
});

describe("compsArv adjustments", () => {
  it("itemizes every adjustment and moves the comp toward the subject", () => {
    // Subject 1500 sq ft, 3 bd, 2 ba, built 2000. Comp sold 200,000, 1400 sq ft, 2 bd, 1.5 ba, built 1990, 6 months ago.
    // sq ft  (1500 - 1400) x 50    = +5,000
    // beds   (3 - 2) x 5,000       = +5,000
    // baths  (2 - 1.5) x 7,500     = +3,750
    // age    (2000 - 1990) x 250   = +2,500
    // time   200,000 x 0.003 x 6   = +3,600
    // net = 5,000 + 5,000 + 3,750 + 2,500 + 3,600 = 19,850. Adjusted = 200,000 + 19,850 = 219,850.
    const r = compsArv({ subject, asOf: AS_OF, comps: [comp({ price: 200000, soldOn: "2026-03-25", sqft: 1400, beds: 2, baths: 1.5, yearBuilt: 1990, distanceMi: 0.5 })] });
    const c = r.comps[0]!;
    expect(c.adjustments.map((a) => [a.key, a.amount])).toEqual([["sqft", 5000], ["beds", 5000], ["baths", 3750], ["age", 2500], ["time", 3600]]);
    expect(c.netAdjustment).toBe(19850);
    expect(c.grossAdjustment).toBe(19850);
    expect(c.adjustedPrice).toBe(219850);
    expect(c.monthsSinceSale).toBe(6);
    expect(c.adjustments[0]!.basis).toBe("Subject 1,500 less comp 1,400, 100 sq ft at 50 each");
    expect(c.adjustments[4]!.basis).toBe("200,000 at 0.3 percent a month for 6 months");
  });

  it("subtracts when the comp is bigger, newer, or sold after the subject's terms", () => {
    // sq ft (1500 - 1800) x 50 = -15,000. age (2000 - 2015) x 250 = -3,750. Adjusted = 300,000 - 18,750 = 281,250.
    const r = compsArv({ subject, asOf: AS_OF, comps: [comp({ price: 300000, sqft: 1800, yearBuilt: 2015 })] });
    const c = r.comps[0]!;
    expect(c.adjustments.find((a) => a.key === "sqft")!.amount).toBe(-15000);
    expect(c.adjustments.find((a) => a.key === "age")!.amount).toBe(-3750);
    expect(c.adjustedPrice).toBe(281250);
    expect(c.grossAdjustment).toBe(18750);
  });

  it("uses the rates passed in rather than the defaults", () => {
    // Same comp, perSqft 100 instead of 50: (1500 - 1400) x 100 = +10,000. Monthly market 0: no time adjustment.
    const r = compsArv({ subject, asOf: AS_OF, comps: [comp({ sqft: 1400, soldOn: "2026-03-25" })], rates: { perSqft: 100, monthlyMarket: 0 } });
    expect(r.comps[0]!.adjustments.find((a) => a.key === "sqft")!.amount).toBe(10000);
    expect(r.comps[0]!.adjustments.find((a) => a.key === "time")!.amount).toBe(0);
    expect(r.comps[0]!.adjustedPrice).toBe(210000);
    expect(r.rates.perSqft).toBe(100);
    expect(r.rates.perBed).toBe(DEFAULT_COMP_RATES.perBed);
  });

  it("adds a lot size adjustment only when both lots are on file", () => {
    // (7000 - 5000) x 2 = +4,000.
    const withLot = compsArv({ subject: { ...subject, lotSqft: 7000 }, asOf: AS_OF, comps: [comp({ lotSqft: 5000 })] });
    expect(withLot.comps[0]!.adjustments.find((a) => a.key === "lot")!.amount).toBe(4000);
    const withoutLot = compsArv({ subject, asOf: AS_OF, comps: [comp({ lotSqft: 5000 })] });
    expect(withoutLot.comps[0]!.adjustments.some((a) => a.key === "lot")).toBe(false);
    expect(withoutLot.comps[0]!.flags).toEqual([]);
  });

  it("itemizes manual adjustments and skips blank ones", () => {
    const r = compsArv({ subject, asOf: AS_OF, comps: [comp({ manual: [{ label: "New roof", amount: -8000 }, { label: "Finished basement", amount: 12000 }, { label: "Ignored", amount: 0 }] })] });
    const c = r.comps[0]!;
    expect(c.adjustments.filter((a) => a.key === "manual").map((a) => a.amount)).toEqual([-8000, 12000]);
    expect(c.netAdjustment).toBe(4000);      // -8,000 + 12,000
    expect(c.grossAdjustment).toBe(20000);   // 8,000 + 12,000
    expect(c.adjustedPrice).toBe(204000);
  });

  it("skips an adjustment when either side is missing and says so", () => {
    const r = compsArv({ subject, asOf: AS_OF, comps: [comp({ sqft: null, soldOn: null, distanceMi: null })] });
    const c = r.comps[0]!;
    expect(c.adjustments.some((a) => a.key === "sqft" || a.key === "time")).toBe(false);
    expect(c.monthsSinceSale).toBeNull();
    expect(c.adjustedPerSqft).toBeNull();
    expect(c.flags).toEqual([
      "Square feet missing, no size adjustment applied.",
      "Sale date missing, no time adjustment applied.",
      "Distance missing, the distance weight falls back to the unknown default.",
    ]);
    expect(c.weightParts).toEqual({ distance: DEFAULT_COMP_SCORING.unknownWeight, recency: DEFAULT_COMP_SCORING.unknownWeight, size: DEFAULT_COMP_SCORING.unknownWeight });
  });

  it("flags a comp whose net adjustment is a large share of its price", () => {
    // 900 sq ft comp against a 1500 sq ft subject: (1500 - 900) x 50 = +30,000 on a 100,000 sale, which is 30 percent.
    const r = compsArv({ subject, asOf: AS_OF, comps: [comp({ price: 100000, sqft: 900 })] });
    expect(r.comps[0]!.netAdjustment).toBe(30000);
    expect(r.comps[0]!.flags[0]).toBe("Net adjustment is 30 percent of the sale price. This comp is far from the subject.");
  });
});

describe("compsArv weights", () => {
  it("weighs closer, more recent, and more similar comps higher", () => {
    // Comp A: 0.5 mi, 6 months, 1400 sq ft against 1500.
    //   distance 1 / (1 + 0.5 / 0.5)             = 0.5
    //   recency  1 / (1 + 6 / 6)                 = 0.5
    //   size     1 / (1 + (100 / 1500) / 0.15)   = 1 / 1.444444 = 0.692308
    //   weight   0.5 x 0.5 x 0.692308            = 0.173077, stored at four places as 0.1731
    // Comp B: on the doorstep, sold today, identical size, so every factor is 1 and the weight is 1.
    const r = compsArv({ subject, asOf: AS_OF, comps: [comp({ id: "a", sqft: 1400, soldOn: "2026-03-25", distanceMi: 0.5 }), comp({ id: "b" })] });
    const [a, b] = r.comps;
    expect(a!.weightParts).toEqual({ distance: 0.5, recency: 0.5, size: 0.6923 });
    expect(a!.weight).toBe(0.1731);
    expect(b!.weightParts).toEqual({ distance: 1, recency: 1, size: 1 });
    expect(b!.weight).toBe(1);
  });

  it("leaves excluded comps in the output with no weight", () => {
    const r = compsArv({ subject, asOf: AS_OF, comps: [comp({ id: "a" }), comp({ id: "b", price: 400000, included: false })] });
    expect(r.comps).toHaveLength(2);
    expect(r.comps[1]!.weight).toBe(0);
    expect(r.comps[1]!.adjustedPrice).toBe(400000);
    expect(r.includedCount).toBe(1);
    expect(r.arv).toBe(200000);
  });
});

describe("compsArv value and confidence", () => {
  it("averages the adjusted prices by weight", () => {
    // Comp A adjusted 200,000 + (1500 - 1400) x 50 + 200,000 x 0.003 x 6 = 200,000 + 5,000 + 3,600 = 208,600, weight 0.1731.
    // Comp B adjusted 220,000 with no adjustments, weight 1.
    // Weighted sum  = 0.1731 x 208,600 + 1 x 220,000 = 36,108.66 + 220,000 = 256,108.66
    // Total weight  = 0.1731 + 1 = 1.1731
    // ARV           = 256,108.66 / 1.1731 = 218,317.84
    const r = compsArv({ subject, asOf: AS_OF, comps: [comp({ id: "a", sqft: 1400, soldOn: "2026-03-25", distanceMi: 0.5 }), comp({ id: "b", price: 220000 })] });
    expect(r.comps[0]!.adjustedPrice).toBe(208600);
    expect(r.comps[0]!.adjustedPerSqft).toBe(149);   // 208,600 / 1,400
    expect(r.arv).toBeCloseTo(218317.84, 2);
    expect(r.perSqft).toBeCloseTo(145.55, 2);        // 218,317.84 / 1,500
  });

  it("scores five tight, close, recent comps near the top", () => {
    // Five identical comps: 200,000, same size as the subject, 0.2 mi away, sold 2026-06-23 (90 days, 3 months).
    // time adjustment 200,000 x 0.003 x 3 = 1,800, so every adjusted price is 201,800 and the spread is 0.
    // count      5 / 5                    = 1     x 0.3 = 0.30
    // dispersion 1 - 0 / 0.2              = 1     x 0.3 = 0.30
    // recency    1 - 3 / 12               = 0.75  x 0.2 = 0.15
    // distance   1 - 0.2 / 2              = 0.9   x 0.2 = 0.18
    // confidence = 0.30 + 0.30 + 0.15 + 0.18 = 0.93
    const five = Array.from({ length: 5 }, (_, i) => comp({ id: `c${i}`, soldOn: "2026-06-23", distanceMi: 0.2 }));
    const r = compsArv({ subject, asOf: AS_OF, comps: five });
    expect(r.includedCount).toBe(5);
    expect(r.arv).toBe(201800);
    expect(r.spread).toBe(0);
    expect(r.low).toBe(201800);
    expect(r.high).toBe(201800);
    expect(r.perSqft).toBe(134.53);                  // 201,800 / 1,500 = 134.5333
    expect(r.confidence).toBe(0.93);
    expect(r.reasons[0]).toBe("5 comps included, at or above the 5 this score looks for.");
    expect(r.reasons[4]).toBe("This score weighs comp count, spread, recency, and distance. It is an estimate aid, not an appraisal.");
  });

  it("drops confidence and widens the range when the adjusted prices disagree", () => {
    // Four comps adjusted to 201,800 and one 250,000 sale adjusted to 250,000 + 250,000 x 0.003 x 3 = 252,250.
    // Every comp carries the same weight, so the mean is the plain average:
    //   ARV      = (4 x 201,800 + 252,250) / 5 = 1,059,450 / 5 = 211,890
    //   variance = (4 x 10,090^2 + 40,360^2) / 5 = 2,036,162,000 / 5 = 407,232,400
    //   spread   = sqrt(407,232,400) = 20,180
    //   low      = max(201,800, 211,890 - 20,180 = 191,710) = 201,800
    //   high     = min(252,250, 211,890 + 20,180 = 232,070) = 232,070
    // dispersion = 20,180 / 211,890 = 0.095238, so the dispersion part is 1 - 0.095238 / 0.2 = 0.523810.
    // confidence = 0.3 x 1 + 0.3 x 0.523810 + 0.2 x 0.75 + 0.2 x 0.9 = 0.3 + 0.157143 + 0.15 + 0.18 = 0.787143, stored as 0.79.
    const comps = Array.from({ length: 5 }, (_, i) => comp({ id: `c${i}`, soldOn: "2026-06-23", distanceMi: 0.2, price: i === 4 ? 250000 : 200000 }));
    const r = compsArv({ subject, asOf: AS_OF, comps });
    expect(r.arv).toBe(211890);
    expect(r.spread).toBe(20180);
    expect(r.low).toBe(201800);
    expect(r.high).toBe(232070);
    expect(r.confidence).toBe(0.79);
    expect(r.reasons[1]).toBe("Adjusted prices sit 9.5 percent around the average, against the 20 percent spread that would score zero.");
  });

  it("scores a thin, far, stale set low", () => {
    // Two comps, 3 miles out, sold 2025-09-21 (365 days, 12.17 months).
    // count      2 / 5      = 0.4  x 0.3 = 0.12
    // dispersion 1          = 1    x 0.3 = 0.30   (both adjust to the same price)
    // recency    1 - 12.17 / 12 clamps to 0      = 0
    // distance   1 - 3 / 2 clamps to 0           = 0
    // confidence = 0.12 + 0.30 = 0.42
    const comps = [comp({ id: "a", soldOn: "2025-09-21", distanceMi: 3 }), comp({ id: "b", soldOn: "2025-09-21", distanceMi: 3 })];
    const r = compsArv({ subject, asOf: AS_OF, comps });
    expect(r.confidence).toBe(0.42);
    expect(r.reasons[2]).toBe("Average sale is 12.2 months old, against the 12 months that would score zero.");
    expect(r.reasons[3]).toBe("Average distance is 3 miles, against the 2 miles that would score zero.");
  });

  it("returns nothing to show when no comp is included", () => {
    const r = compsArv({ subject, asOf: AS_OF, comps: [comp({ included: false })] });
    expect(r.arv).toBeNull();
    expect(r.low).toBeNull();
    expect(r.high).toBeNull();
    expect(r.perSqft).toBeNull();
    expect(r.spread).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.reasons).toEqual(["No comps are included, so there is nothing to average."]);
  });

  it("leaves price per square foot out when the subject square feet are not on file", () => {
    const r = compsArv({ subject: { ...subject, sqft: null }, asOf: AS_OF, comps: [comp()] });
    expect(r.arv).toBe(200000);
    expect(r.perSqft).toBeNull();
    expect(r.comps[0]!.weightParts.size).toBe(DEFAULT_COMP_SCORING.unknownWeight);
  });
});
