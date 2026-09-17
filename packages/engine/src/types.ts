export type WeekRow = { week: number; cashIn: number; expenses: number; balance: number };

export type ProForma = {
  salePrice: number;
  grossRents: number; management: number; propertyTaxes: number; insurance: number;
  ownerPaidUtilities: number; vacancyReserve: number; maintenanceReserve: number;
  totalOperatingExpenses: number; monthlyNoi: number; annualizedNoi: number; capRate: number;
  loanToValue: number; downPayment: number; closingCosts: number; principal: number;
  interestRate: number; termYears: number; monthlyMortgage: number; monthlyNet: number;
  annualizedNet: number; annualizedRoi: number;
};

export type DcrBlock = {
  grossRents: number; vacancy: number; propMgmt: number; cashReserves: number; taxes: number;
  insurance: number; maintenanceUtilities: number; totalExpenses: number; noi: number;
  mortgage: number; dcr: number; netProfit: number;
};
