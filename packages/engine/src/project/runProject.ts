import type { ProjectModelInput } from "./schemas";
import { feeTotals, type FeeTotals } from "./fees";
import { holdingLines, type HoldingLinesResult } from "./holdingLines";
import { projectFinancing, type ProjectFinancingResult } from "./financing";
import { buildProjectTimeline, projectCashFlow, type ProjectCashFlowResult } from "./cashFlow";
import { rentalProjection, type RentalProjectionResult } from "./rentalProjection";
import { pendingModule, type ModuleResult, type ProjectContext } from "./types";

/** Saved inside the outputs. Stays a preview until Ous approves the model. */
export const PROJECT_MODEL_VERSION = "0.2.0-preview";

export type ProjectFlipResult = {
  purchase: number; buyingCosts: number; repairs: number; holding: number;
  /** Null while a drawn balance loan has no calendar timeline to price its interest against. */
  financing: number | null;
  selling: number; otherNet: number; sale: number;
  totalProjectCosts: number | null; netProfit: number | null;
  /** Return on all costs, on purchase plus rehab, and on the owner cash the weekly cash flow needs. */
  costRoi: number | null; purchaseRepairRoi: number | null; cashRoi: number | null;
};

export type ProjectOutputs = {
  modelVersion: string;
  buyingFees: FeeTotals; sellingFees: FeeTotals; holding: HoldingLinesResult; financing: ProjectFinancingResult;
  flip: ProjectFlipResult;
  cashFlow: ModuleResult<ProjectCashFlowResult>;
  rentalProjection: ModuleResult<RentalProjectionResult> | null;
  /** What is not calculated yet, in words the results tab can show. */
  pending: { module: "financing" | "cashFlow" | "rentalProjection" | "cashRoi"; reason: string }[];
};

const ratio = (top: number | null, bottom: number | null): number | null => (top === null || bottom === null || !(bottom > 0) ? null : top / bottom);

export function runProject(input: ProjectModelInput, ctx: ProjectContext): ProjectOutputs {
  const timeline = buildProjectTimeline(input, ctx);
  const calendar = timeline.status === "computed" ? timeline.value : undefined;
  const buyingFees = feeTotals(input.buyingFees, ctx);
  const sellingFees = feeTotals(input.sellingFees, ctx);
  const holding = holdingLines(input.holdingCosts, ctx.holdMonths);
  const financing = projectFinancing(input.loans, ctx, calendar);
  const cashFlow = calendar ? projectCashFlow(input, ctx, calendar, financing) : pendingModule<ProjectCashFlowResult>(timeline.status === "pending" ? timeline.reason : "");
  const projection = input.rentalProjection ? rentalProjection(input.rentalProjection, ctx.rental) : null;

  const otherNet = input.customCashEvents.reduce((a, e) => a + e.amount, 0);
  const knownCosts = ctx.purchasePrice + buyingFees.total + ctx.rehabEstimate + holding.total + sellingFees.total;
  const totalProjectCosts = financing.total === null ? null : knownCosts + financing.total;
  const netProfit = totalProjectCosts === null ? null : ctx.salePrice - totalProjectCosts + otherNet;
  const ownerCash = cashFlow.status === "computed" ? cashFlow.value.totalOwnerCashRequired : null;
  const flip: ProjectFlipResult = {
    purchase: ctx.purchasePrice, buyingCosts: buyingFees.total, repairs: ctx.rehabEstimate, holding: holding.total, financing: financing.total,
    selling: sellingFees.total, otherNet, sale: ctx.salePrice, totalProjectCosts, netProfit,
    costRoi: ratio(netProfit, totalProjectCosts), purchaseRepairRoi: ratio(netProfit, ctx.purchasePrice + ctx.rehabEstimate), cashRoi: ratio(netProfit, ownerCash),
  };

  const pendingList: ProjectOutputs["pending"] = [];
  if (financing.pendingLoans.length) pendingList.push({ module: "financing", reason: `Interest on the drawn balance needs the weekly project cash flow (${financing.pendingLoans.join(", ")}). ${timeline.status === "pending" ? timeline.reason : ""}`.trim() });
  if (cashFlow.status === "pending") pendingList.push({ module: "cashFlow", reason: cashFlow.reason });
  if (flip.cashRoi === null) pendingList.push({ module: "cashRoi", reason: ownerCash === null ? "Return on owner cash needs the owner cash figure from the weekly project cash flow." : "Return on owner cash needs owner cash above zero. This project is funded entirely by the loans." });
  if (projection?.status === "pending") pendingList.push({ module: "rentalProjection", reason: projection.reason });

  return { modelVersion: PROJECT_MODEL_VERSION, buyingFees, sellingFees, holding, financing, flip, cashFlow, rentalProjection: projection, pending: pendingList };
}
