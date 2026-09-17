import { describe, it, expect } from "vitest";
import { amortization } from "../src";
import { loadFixture, expectClose, expectCloseArray } from "./helpers";

const fx = loadFixture("amortization.json");

describe("Amortization golden", () => {
  const out = amortization({
    loanAmount: fx.inputs.loanAmount,
    annualRate: fx.inputs.annualRate,
    periods: fx.inputs.periods,
    startDate: fx.inputs.startDate,
    daysInMonth: fx.inputs.daysInMonth,
    payoffLookupMonths: fx.inputs.payoffLookupMonths,
    monthlyInsurance: fx.inputs.monthlyInsurance,
    monthlyRevenue: fx.inputs.monthlyRevenue,
  });
  const e = fx.expected;

  it("payment B5 and summary", () => {
    expectClose(out.payment, e.payment, "B5");
    expectClose(out.payment, e.summary.payment, "R4");
  });

  it("all 60 rows including the TODAY() driven dates", () => {
    expect(out.rows.length).toBe(60);
    e.rows.forEach((row: any, i: number) => {
      const r = out.rows[i]!;
      expect(r.period).toBe(row.period);
      expect(r.date, `C${10 + i}`).toBe(String(row.date).slice(0, 10));
      expect(r.daysInMonth, `A${10 + i}`).toBe(row.daysInMonth);
      expectClose(r.beginningBalance, row.beginningBalance, `D${10 + i}`);
      expectClose(r.payment, row.payment, `E${10 + i}`);
      expectClose(r.principal, row.principal, `F${10 + i}`);
      expectClose(r.interest, row.interest, `G${10 + i}`);
      expectClose(r.cumulativePrincipal, row.cumulativePrincipal, `H${10 + i}`);
      expectClose(r.cumulativeInterest, row.cumulativeInterest, `I${10 + i}`);
      expectClose(r.endingBalance, row.endingBalance, `J${10 + i}`);
    });
    expectCloseArray(out.rows.map((r) => r.endingBalance), e.endingBalances, "J10:J69");
  });

  it("payoff lookups E5:J5 and totals", () => {
    expectCloseArray(out.payoffAmounts, e.payoffAmounts, "E5:J5");
    expectClose(out.totalPrincipal, e.totals.principal, "F71");
    expectClose(out.totalInterest, e.totals.interest, "G71");
  });

  it("vehicle side table for parity (A-13)", () => {
    expectClose(out.side.monthlyOpsProfit, e.monthlyOpsProfit, "B6");
    expectCloseArray(out.side.ownerRealizedProfit, e.ownerRealizedProfit, "E6:J6");
    expectCloseArray(out.side.vdaRealizedProfit, e.vdaRealizedProfit, "E7:J7");
    e.rows.forEach((row: any, i: number) => {
      const s = out.side.rows[i]!;
      expectClose(s.profit, row.side.profit, `T${10 + i}`);
      expectClose(s.investorProfit, row.side.investorProfit, `V${10 + i}`);
      expectClose(s.vdaProfit, row.side.vdaProfit, `W${10 + i}`);
      expectClose(s.financialRisk, row.side.financialRisk, `U${10 + i}`);
    });
    expectClose(out.side.totals.revenue, e.totals.revenue, "S70");
    expectClose(out.side.totals.profit, e.totals.profit, "T70");
    expectClose(out.side.totals.investorProfit, e.totals.investorProfit, "V70");
    expectClose(out.side.totals.vdaProfit, e.totals.vdaProfit, "W70");
  });
});
