import { describe, it } from "vitest";
import { quickOffers } from "../src";
import { loadFixture, expectClose } from "./helpers";

const fx = loadFixture("quick-offers.json");

describe("Quick Offers golden", () => {
  const out = quickOffers({
    comps: fx.inputs.comps,
    squareFeet: fx.inputs.squareFeet,
    assignmentFee: { full: fx.inputs.assignmentFeeFull, medium: fx.inputs.assignmentFeeMedium, light: fx.inputs.assignmentFeeLight },
    costPerSqft: { full: fx.inputs.costPerSqftFull, medium: fx.inputs.costPerSqftMedium, light: fx.inputs.costPerSqftLight },
    valueWant: fx.inputs.valueWant,
    valueAre: fx.inputs.valueAre,
  });

  it("reproduces ARV and every tier", () => {
    expectClose(out.arv, fx.expected.arv, "arv F3");
    expectClose(out.arv, fx.expected.arvAverage, "arv K3");
    for (const tier of ["full", "medium", "light"] as const) {
      for (const key of Object.keys(fx.expected[tier])) {
        expectClose((out[tier] as any)[key], fx.expected[tier][key], `${tier}.${key}`);
      }
    }
  });

  it("reproduces the value block", () => {
    expectClose(out.valueWantPrice, fx.expected.valueWantPrice, "F14");
    expectClose(out.valueArePrice, fx.expected.valueArePrice, "F15");
    expectClose(out.valueWant, fx.expected.valueWant, "K14");
    expectClose(out.valueAre, fx.expected.valueAre, "K15");
    expectClose(out.valueDifference, fx.expected.valueDifference, "K16");
  });
});
