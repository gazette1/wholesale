/**
 * One flag per anomaly in spec/ANOMALIES.md that has a corrected form.
 * Every default is false, which means "behave exactly like the workbook".
 * Flip a flag only after Ous decides. Golden tests run with all flags false.
 */
export type AnomalyFlags = {
  /** A-01: up front ROI on cash reads its own block (H47/H46) instead of the delayed block. Same value either way. */
  fixUpfrontRoiLink: boolean;
  /** A-02: buying costs on purchase price and selling costs on ARV, instead of the sheet's mixed bases. */
  fixTransactionCostBases: boolean;
  /** A-08: round delayed draw weeks up to whole weeks like the up front sheet. */
  roundDelayedDrawWeeks: boolean;
  /** A-17: week 11 construction test subtracts the week 10 cost instead of the literal 15. */
  fixConstructionWeek11: boolean;
  /** A-18: up front cash to cover is zero when the minimum balance is positive. */
  fixUpfrontCashToCover: boolean;
  /** A-21: second mortgage interest is multiplied by hold months like the first mortgage. */
  secondInterestTimesHold: boolean;
  /** A-22: the Utilities holding cost gets a monthly column on the cash flow. */
  utilitiesInCashFlow: boolean;
  /** A-24: property taxes and HOA spread monthly on the cash flow instead of week 1. */
  monthlyTaxesAndHoa: boolean;
  /** A-26: DCR pro forma column uses current rents and actual column uses market rents consistently. */
  fixDcrRentSets: boolean;
  /** A-28: amortization uses real calendar month lengths, leap years included. */
  calendarMonthLengths: boolean;
};

export const DEFAULT_FLAGS: AnomalyFlags = {
  fixUpfrontRoiLink: false,
  fixTransactionCostBases: false,
  roundDelayedDrawWeeks: false,
  fixConstructionWeek11: false,
  fixUpfrontCashToCover: false,
  secondInterestTimesHold: false,
  utilitiesInCashFlow: false,
  monthlyTaxesAndHoa: false,
  fixDcrRentSets: false,
  calendarMonthLengths: false,
};

export function withFlags(partial?: Partial<AnomalyFlags>): AnomalyFlags {
  return { ...DEFAULT_FLAGS, ...(partial ?? {}) };
}
