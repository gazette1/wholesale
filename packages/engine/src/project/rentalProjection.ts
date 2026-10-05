import type { BuyAndHoldInput } from "../buyAndHold";
import { cumipmt, pmt } from "../money";
import type { RentalProjectionAssumptions } from "./schemas";
import { pendingModule, type ModuleResult, type ProjectRentalContext } from "./types";

export type RentalProjectionYear = {
  year: number; rent: number; operatingExpenses: number; noi: number; debtService: number;
  cashFlow: number; paydown: number; appreciation: number; depreciation: number; taxSavings: number;
  interest: number; propertyValue: number; annualTotal: number; cumulativeTotal: number; annualRoi: number; cumulativeRoi: number;
};

export type RentalProjectionResult = {
  years: RentalProjectionYear[];
  /** Down payment plus closing costs plus owner funded initial rehab. Every return percent divides by it. */
  initialCash: number;
  downPayment: number; closingCosts: number; ownerFundedRehab: number; principal: number;
  monthlyPayment: number;
};

/** Rental inputs for the projection, read off the deal's Buy and hold case. Market rent is used, current rent when no market rent is entered. */
export function projectRentalContext(bh: BuyAndHoldInput | null | undefined): ProjectRentalContext | null {
  if (!bh || bh.units.length === 0) return null;
  const market = bh.units.reduce((a, u) => a + (u.marketRent ?? 0), 0);
  const current = bh.units.reduce((a, u) => a + (u.rent ?? 0), 0);
  return {
    price: bh.salePrice,
    grossMonthlyRent: market > 0 ? market : current,
    percentOfRentExpenses: bh.managementPct + bh.vacancyPct + bh.maintenancePct + bh.cashReservesPct,
    fixedMonthlyExpenses: bh.propertyTaxYear / 12 + bh.insuranceMonth + bh.gasElectricMonth + bh.waterMonth + bh.sewerMonth + bh.garbageMonth + bh.lawnSnowMonth,
    downPaymentPct: bh.downPaymentPct, closingCosts: bh.closingCosts, interestRate: bh.interestRate, loanTermYears: bh.loanTermYears,
    appreciationRate: bh.appreciationRate, rentGrowthRate: bh.rentGrowthRate,
  };
}

/**
 * Return projection past year five. Operating expenses in dollars stay constant, expenses that are a share
 * of rent grow with the rent, and the estimated tax savings sit outside operating cash flow.
 */
export function rentalProjection(assumptions: RentalProjectionAssumptions, rental: ProjectRentalContext | null | undefined): ModuleResult<RentalProjectionResult> {
  if (!rental) return pendingModule("The projection needs the Buy and hold inputs. Add at least one rental unit with a rent and a sale price.");

  const downPayment = rental.downPaymentPct * rental.price;
  const principal = rental.price - downPayment;
  const initialCash = downPayment + rental.closingCosts + assumptions.ownerFundedRehab;
  const monthlyRate = rental.interestRate / 12;
  const nper = Math.round(rental.loanTermYears * 12);
  const monthlyPayment = principal > 0 && nper > 0 ? -pmt(monthlyRate, nper, principal) : 0;

  const fixedAnnual = rental.fixedMonthlyExpenses * 12;
  const annualDepreciation = assumptions.depreciableBasis / assumptions.depreciationYears;
  let remainingBasis = assumptions.depreciableBasis;
  let cumulativeTotal = 0;
  let previousValue = rental.price;
  const years: RentalProjectionYear[] = [];
  for (let year = 1; year <= assumptions.years; year++) {
    const rent = rental.grossMonthlyRent * 12 * Math.pow(1 + rental.rentGrowthRate, year - 1);
    const operatingExpenses = rent * rental.percentOfRentExpenses + fixedAnnual;
    const noi = rent - operatingExpenses;
    const loanAlive = principal > 0 && nper > 0 && 12 * (year - 1) < nper;
    const debtService = loanAlive ? monthlyPayment * 12 : 0;
    const cashFlow = noi - debtService;
    const interest = loanAlive ? -cumipmt(monthlyRate, nper, principal, 12 * (year - 1) + 1, Math.min(12 * year, nper)) : 0;
    const paydown = debtService - interest;
    const propertyValue = previousValue * (1 + rental.appreciationRate);
    const appreciation = propertyValue - previousValue;
    previousValue = propertyValue;
    const depreciation = Math.max(0, Math.min(annualDepreciation, remainingBasis));
    remainingBasis -= depreciation;
    const taxSavings = (depreciation + interest) * assumptions.marginalTaxRate;
    const annualTotal = cashFlow + paydown + appreciation + taxSavings;
    cumulativeTotal += annualTotal;
    years.push({
      year, rent, operatingExpenses, noi, debtService, cashFlow, paydown, appreciation, depreciation, taxSavings, interest, propertyValue,
      annualTotal, cumulativeTotal,
      annualRoi: initialCash > 0 ? annualTotal / initialCash : 0,
      cumulativeRoi: initialCash > 0 ? cumulativeTotal / initialCash : 0,
    });
  }
  return { status: "computed", value: { years, initialCash, downPayment, closingCosts: rental.closingCosts, ownerFundedRehab: assumptions.ownerFundedRehab, principal, monthlyPayment } };
}
