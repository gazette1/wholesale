import { describe, it, expect } from "vitest";
import { rehabEstimator } from "../src";
import { loadFixture, expectClose } from "./helpers";

const fx = loadFixture("rehab-estimator.json");

describe("Rehab Estimator golden", () => {
  const out = rehabEstimator({ address: fx.inputs.address, lines: fx.inputs.lines });

  it("reproduces the total I1", () => {
    expectClose(out.total, fx.expected.total, "I1");
    expect(out.total).toBe(20050);
  });

  it("reproduces every line total I3:I69", () => {
    fx.inputs.lines.forEach((line: any, i: number) => {
      expectClose(out.lineTotals[i]!, fx.expected.lineTotals[`I${line.row}`], `I${line.row}`);
    });
  });
});
