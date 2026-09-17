import { pmt, cumipmt, average } from "./money";
import { withFlags, type AnomalyFlags } from "./anomalies";
import type { ProForma, DcrBlock } from "./types";

export type Unit = { unit: number | null; beds: number | null; baths: number | null; rent: number | null; marketRent: number | null };

export type BuyAndHoldInput = {
  salePrice: number; taxValue: number; units: Unit[];
  propertyTaxYear: number; insuranceMonth: number; gasElectricMonth: number; waterMonth: number;
  sewerMonth: number; garbageMonth: number; lawnSnowMonth: number;
  managementPct: number; vacancyPct: number; maintenancePct: number; cashReservesPct: number;
  downPaymentPct: number; interestRate: number; loanTermYears: number; closingCosts: number;
  improvedValueRatio: number; marginalTaxRate: number; appreciationRate: number; rentGrowthRate: number;
  dcrRequired: number;
  /** Buy & Hold 2 types these instead of linking to the inputs. Optional overrides for parity with that sheet. */
  dcrVacancyPct?: number; dcrManagementPct?: number; dcrMaintenancePct?: number;
  rentGrowthYears?: number;
  flags?: Partial<AnomalyFlags>;
};

export type BuyAndHoldOutput = {
  totalRent: number; totalMarketRent: number;
  current: ProForma; market: ProForma;
  debtPaydown: { year: number; interestPaid: number; totalDebtPaydown: number; roiOnPaydown: number }[];
  taxDeductions: { year: number; depreciation: number; totalInterestPaid: number; totalDeductions: number }[];
  avgYearlyTaxSavings: number; annualRoiOnTaxSavings: number;
  dcr: { proForma: DcrBlock; actual: DcrBlock; required: number; proFormaQualifies: boolean; actualQualifies: boolean };
  appreciation: { year: number; estValue: number; annualGain: number; pctGain: number }[];
  totalReturn: { year: number; cashFlow: number; debtPaydown: number; taxSavings: number; appreciation: number; totalRoi: number; totalDollarReturn: number }[];
  rentGrowth: { year: number; marketRent: number }[];
  marketRentYear1: number;
};

export const DEPRECIATION_YEARS = 27.5;   // hardcoded on the sheet (P25, P28, P31, P34, P37)

function proForma(input: BuyAndHoldInput, grossRents: number): ProForma {
  const management = input.managementPct * grossRents;                                  // I9, I24
  const propertyTaxes = input.propertyTaxYear / 12;                                       // I10, I25
  const insurance = input.insuranceMonth;                                                 // I11, I26
  const ownerPaidUtilities = input.gasElectricMonth + input.waterMonth + input.sewerMonth + input.garbageMonth + input.lawnSnowMonth;   // I12, I27
  const vacancyReserve = input.vacancyPct * grossRents;                                   // I13, I28
  const maintenanceReserve = grossRents * input.maintenancePct;                           // I14, I29
  const totalOperatingExpenses = management + propertyTaxes + insurance + ownerPaidUtilities + vacancyReserve + maintenanceReserve;   // I15, I30
  const monthlyNoi = grossRents - totalOperatingExpenses;                                  // I16, I31
  const annualizedNoi = monthlyNoi * 12;                                                   // I17, I32
  const capRate = annualizedNoi / input.salePrice;                                         // I18, I33
  const loanToValue = 1 - input.downPaymentPct;                                            // L9, L24
  const downPayment = input.downPaymentPct * input.salePrice;                              // L10, L25 (ANOMALY-A-11 placeholder 1%)
  const closingCosts = input.closingCosts;                                                 // L11, L26
  const principal = input.salePrice * loanToValue;                                         // L12, L27
  const monthlyMortgage = -pmt(input.interestRate / 12, input.loanTermYears * 12, principal);   // L15, L30
  const monthlyNet = monthlyNoi - monthlyMortgage;                                         // L16, L31
  const annualizedNet = monthlyNet * 12;                                                   // L17, L32
  const annualizedRoi = annualizedNet / (downPayment + closingCosts);                      // L18, L33
  return {
    salePrice: input.salePrice,   // L8, L23
    grossRents, management, propertyTaxes, insurance, ownerPaidUtilities, vacancyReserve, maintenanceReserve,
    totalOperatingExpenses, monthlyNoi, annualizedNoi, capRate, loanToValue, downPayment, closingCosts, principal,
    interestRate: input.interestRate, termYears: input.loanTermYears, monthlyMortgage, monthlyNet, annualizedNet, annualizedRoi,
  };
}

export function buyAndHold(input: BuyAndHoldInput): BuyAndHoldOutput {
  const flags = withFlags(input.flags);
  const totalRent = input.units.reduce((a, u) => a + (u.rent ?? 0), 0);              // E29
  const totalMarketRent = input.units.reduce((a, u) => a + (u.marketRent ?? 0), 0);  // F29
  const current = proForma(input, totalRent);
  const market = proForma(input, totalMarketRent);

  const monthlyRate = input.interestRate / 12;
  const nper = input.loanTermYears * 12;
  const debtPaydown = [1, 2, 3, 4, 5].map((year) => {
    const interestPaid = -cumipmt(monthlyRate, nper, current.principal, 1 + 12 * (year - 1), 12 * year, 0);   // P26, P29, P32, P35, P38
    const totalDebtPaydown = current.monthlyMortgage * 12 - interestPaid;                                     // P8, P10, P12, P14, P16
    const roiOnPaydown = totalDebtPaydown / current.downPayment;                                              // P9, P11, P13, P15, P17
    return { year, interestPaid, totalDebtPaydown, roiOnPaydown };
  });

  const depreciationYear1 = (input.improvedValueRatio * input.salePrice) / DEPRECIATION_YEARS;   // P25
  const taxDeductions = debtPaydown.map((d) => ({
    year: d.year,
    depreciation: (input.improvedValueRatio * input.salePrice) / DEPRECIATION_YEARS,           // P25, P28, P31, P34, P37
    totalInterestPaid: d.interestPaid,
    totalDeductions: depreciationYear1 + d.interestPaid,                                        // P27, P30, ... (ANOMALY-A-33 uses $P$25)
  }));
  const avgYearlyTaxSavings = average(taxDeductions.map((t) => t.totalDeductions)) * input.marginalTaxRate;   // P40
  const annualRoiOnTaxSavings = avgYearlyTaxSavings / current.downPayment;                                  // P41

  const vac = input.dcrVacancyPct ?? input.vacancyPct;            // T10 (= C41 on sheet 1)
  const mgmt = input.dcrManagementPct ?? input.managementPct;     // T11 (= C40)
  const maint = input.dcrMaintenancePct ?? input.maintenancePct;  // T15 (= C42)
  const pfGross = current.grossRents * 12;                        // U9
  const pfVacancy = pfGross * vac;                                // U10
  const pfPropMgmt = pfGross * mgmt;                              // U11
  const pfCashReserves = input.cashReservesPct * pfGross;         // U12
  const pfTaxes = current.propertyTaxes * 12;                     // U13
  const pfInsurance = current.insurance * 12;                     // U14
  const pfMaint = pfGross * maint;                                // U15
  const pfTotal = pfVacancy + pfPropMgmt + pfCashReserves + pfTaxes + pfInsurance + pfMaint;   // U16
  const pfNoi = pfGross - pfTotal;                                // U17
  const mortgageYear = current.monthlyMortgage * 12;              // U18, V18
  const proFormaBlock: DcrBlock = {
    grossRents: pfGross, vacancy: pfVacancy, propMgmt: pfPropMgmt, cashReserves: pfCashReserves, taxes: pfTaxes,
    insurance: pfInsurance, maintenanceUtilities: pfMaint, totalExpenses: pfTotal, noi: pfNoi, mortgage: mortgageYear,
    dcr: pfNoi / mortgageYear, netProfit: pfNoi - mortgageYear,   // U20, U21
  };

  // ANOMALY-A-26: "Actual" uses market gross rents but current rent reserves. The flag makes column V all market.
  const useMarket = flags.fixDcrRentSets;
  const actGross = market.grossRents * 12;                                                            // V9
  const actVacancy = (useMarket ? market.vacancyReserve : current.vacancyReserve) * 12;               // V10 = I13 * 12
  const actPropMgmt = 12 * (useMarket ? market.management : current.management);                      // V11 = 12 * I9
  const actCashReserves = input.cashReservesPct * actGross;                                           // V12
  const actTaxes = current.propertyTaxes * 12;                                                        // V13
  const actInsurance = current.insurance * 12;                                                        // V14
  const actMaint = (current.ownerPaidUtilities + (useMarket ? market.maintenanceReserve : current.maintenanceReserve)) * 12;   // V15 = (I12 + I14) * 12
  const actTotal = actVacancy + actPropMgmt + actCashReserves + actTaxes + actInsurance + actMaint;   // V16
  const actNoi = actGross - actTotal;                                                                 // V17
  const actualBlock: DcrBlock = {
    grossRents: actGross, vacancy: actVacancy, propMgmt: actPropMgmt, cashReserves: actCashReserves, taxes: actTaxes,
    insurance: actInsurance, maintenanceUtilities: actMaint, totalExpenses: actTotal, noi: actNoi, mortgage: mortgageYear,
    dcr: actNoi / mortgageYear, netProfit: actNoi - mortgageYear,   // V20, V21
  };

  const appreciation: BuyAndHoldOutput["appreciation"] = [];
  let previousValue = input.salePrice;
  for (let year = 1; year <= 5; year++) {
    const estValue = previousValue + previousValue * input.appreciationRate;   // S27:S31
    const annualGain = estValue - previousValue;                                // T27:T31
    const pctGain = annualGain / current.downPayment;                           // U27:U31
    appreciation.push({ year, estValue, annualGain, pctGain });
    previousValue = estValue;
  }

  const totalReturn = [1, 2, 3, 4, 5].map((year) => {
    const cashFlow = market.annualizedRoi;                                   // S36:W36 = $L$33
    const paydown = debtPaydown[year - 1]!.roiOnPaydown;                     // S37:W37
    const taxSavings = (taxDeductions[year - 1]!.totalDeductions * input.marginalTaxRate) / current.downPayment;   // S38:W38
    const app = appreciation[year - 1]!.pctGain;                             // S39:W39
    const totalRoi = cashFlow + paydown + taxSavings + app;                  // S40:W40
    return { year, cashFlow, debtPaydown: paydown, taxSavings, appreciation: app, totalRoi, totalDollarReturn: totalRoi * current.downPayment };   // S41:W41
  });

  const years = input.rentGrowthYears ?? 20;
  const rentGrowth = Array.from({ length: years }, (_, i) => ({
    year: i + 1,
    marketRent: totalMarketRent * Math.pow(1 + input.rentGrowthRate, i),   // Z9:Z28
  }));

  return {
    totalRent, totalMarketRent, current, market, debtPaydown, taxDeductions, avgYearlyTaxSavings, annualRoiOnTaxSavings,
    dcr: {
      proForma: proFormaBlock, actual: actualBlock, required: input.dcrRequired,   // ANOMALY-A-25: T6 is never checked on the sheet
      proFormaQualifies: proFormaBlock.dcr >= input.dcrRequired, actualQualifies: actualBlock.dcr >= input.dcrRequired,
    },
    appreciation, totalReturn, rentGrowth, marketRentYear1: totalMarketRent,
  };
}
