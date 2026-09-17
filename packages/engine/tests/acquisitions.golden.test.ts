import { describe, it, expect } from "vitest";
import { acquisitions } from "../src";
import { loadFixture, expectClose, acquisitionsInputFromFixture } from "./helpers";

const fx = loadFixture("acquisitions.json");

describe("Acquisitions golden", () => {
  const out = acquisitions(acquisitionsInputFromFixture());
  const e = fx.expected;

  it("offer block N3:N8", () => {
    expectClose(out.offer.seventyPercentArv, e.seventyPercentArv, "N3");
    expectClose(out.offer.allInMaxLimit, e.allInMaxLimit, "N5");
    expectClose(out.offer.offerRepairCosts, e.offerRepairCosts, "N6");
    expectClose(out.offer.offer, e.offer, "N7");
    expectClose(out.offer.offerPctOfArv, e.offerPctOfArv, "N8", "ratio");
  });

  it("financing F20:F26 and E32", () => {
    expectClose(out.financing.firstPointsPaid, e.firstPointsPaid, "F20");
    expectClose(out.financing.firstInterestPaid, e.firstInterestPaid, "F21");
    expectClose(out.financing.firstInterestOnlyPaid, e.firstInterestOnlyPaid, "F22");
    expectClose(out.financing.secondPointsPaid, e.secondPointsPaid, "F24");
    expectClose(out.financing.secondInterestPaid, e.secondInterestPaid, "F25");
    expectClose(out.financing.secondInterestOnlyPaid, e.secondInterestOnlyPaid, "F26");
    expectClose(out.financing.total, e.totalFinancingCosts, "E32");
  });

  it("holding K19:K31 and J32", () => {
    expectClose(out.holding.propertyTaxesTotal, e.propertyTaxesTotal, "K19");
    expectClose(out.holding.hoaTotal, e.hoaTotal, "K20");
    expectClose(out.holding.insuranceTotal, e.insuranceTotal, "K21");
    expectClose(out.holding.utilitiesTotal, e.utilitiesTotal, "K22");
    expectClose(out.holding.gasTotal, e.gasTotal, "K23");
    expectClose(out.holding.waterTotal, e.waterTotal, "K24");
    expectClose(out.holding.electricityTotal, e.electricityTotal, "K25");
    expectClose(out.holding.miscUtilitiesTotal, e.miscUtilitiesTotal, "K26");
    expectClose(out.holding.totalMaintenanceCosts, e.totalMaintenanceCosts, "J27");
    out.holding.miscHoldingTotal.forEach((v, i) => expectClose(v, e[`miscHoldingTotal${i + 1}`], `K${28 + i}`));
    expectClose(out.holding.total, e.totalHoldingCosts, "J32");
  });

  it("buying and selling costs", () => {
    expectClose(out.buying.escrow, e.buyEscrow, "F37");
    expectClose(out.buying.title, e.buyTitle, "F38");
    expectClose(out.buying.misc, e.buyMisc, "F39");
    expectClose(out.buying.total, e.totalBuyingCosts, "J12");
    expectClose(out.selling.escrow, e.sellEscrow, "F42");
    expectClose(out.selling.recording, e.sellRecording, "F43");
    expectClose(out.selling.realtor, e.sellRealtor, "F44");
    expectClose(out.selling.transfer, e.sellTransfer, "F45");
    expectClose(out.selling.total, e.totalSellingCosts, "J13");
  });

  it("deal summary and ROI", () => {
    expectClose(out.purchaseAndRepairCosts, e.purchaseAndRepairCosts, "E14");
    expectClose(out.netProfit, e.netProfit, "J14");
    expectClose(out.cashInvested, e.cashInvested, "N11");
    expectClose(out.cashReturn, e.cashReturn, "N12");
    expectClose(out.roiOnCash, e.roiOnCash, "N13", "ratio");
    expect(out.timeToReturn).toBe(e.timeToReturn);
  });

  it("delayed and up front scenario ROI", () => {
    expectClose(out.delayed.cashInvested, e.delayedCashInvested, "H39");
    expectClose(out.delayed.cashToCover, e.delayedCashToCover, "I39");
    expectClose(out.delayed.totalCash, e.delayedTotalCash, "J39");
    expectClose(out.delayed.cashReturn, e.delayedCashReturn, "J40");
    expectClose(out.delayed.expectedRoi, e.delayedExpectedRoi, "H41", "ratio");
    expectClose(out.delayed.actualRoi, e.delayedActualRoi, "J41", "ratio");
    expectClose(out.upfront.cashInvested, e.upfrontCashInvested, "H46");
    expectClose(out.upfront.cashToCover, e.upfrontCashToCover, "I46");
    expectClose(out.upfront.totalCash, e.upfrontTotalCash, "J46");
    expectClose(out.upfront.cashReturn, e.upfrontCashReturn, "J47");
    expectClose(out.upfront.expectedRoi, e.upfrontExpectedRoi, "H48", "ratio");
    expectClose(out.upfront.actualRoi, e.upfrontActualRoi, "J48", "ratio");
  });

  it("excess cash on both cash flows equals net profit", () => {
    expectClose(out.delayed.cashFlow.excessCash, e.netProfit, "delayed E43");
    expectClose(out.upfront.cashFlow.excessCash, e.netProfit, "upfront E43");
  });
});
