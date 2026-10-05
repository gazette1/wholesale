import { rehabEstimator, type RehabEstimatorInput } from "./rehabEstimator";

/**
 * Which number drives repairs. The workbook links the checklist total with a
 * manual override (A-04). The Mac app adds a per square foot mode; all three live here.
 */
export type RehabSource = "checklist" | "manual" | "perSqft";
export type RehabPlan = { source: RehabSource; perSqftRate?: number; squareFeet?: number };

export type RehabPlanResult = {
  source: RehabSource; estimate: number; checklistTotal: number; includedCount: number; completedCount: number; completion: number; incompleteCount: number;
};

type LineWithStatus = RehabEstimatorInput["lines"][number] & { status?: string | null };

/**
 * Resolve the repair estimate. Without a plan the legacy rule applies: an
 * override wins, else the checklist. Completion counts finished items only; it
 * does not measure money spent.
 */
export function resolveRehab(rehab: RehabEstimatorInput, plan: RehabPlan | null | undefined, manualOverride: number | null | undefined): RehabPlanResult {
  const checklistTotal = rehabEstimator(rehab).total;
  const included = (rehab.lines as LineWithStatus[]).filter((l) => l.answer === "Yes");
  const completed = included.filter((l) => l.status === "done");
  const incomplete = included.filter((l) => !(Number(l.unitCost) > 0) || !(Number(l.quantity) > 0));
  const source: RehabSource = plan?.source ?? (manualOverride != null ? "manual" : "checklist");
  let estimate = checklistTotal;
  if (source === "manual") estimate = manualOverride ?? 0;
  if (source === "perSqft") estimate = Math.max(0, plan?.perSqftRate ?? 0) * Math.max(0, plan?.squareFeet ?? 0);
  return {
    source, estimate, checklistTotal, includedCount: included.length, completedCount: completed.length,
    completion: included.length === 0 ? 0 : completed.length / included.length, incompleteCount: incomplete.length,
  };
}

/** The override to hand to acquisitions(): null means "use the checklist". */
export function repairOverrideFor(result: RehabPlanResult): number | null {
  return result.source === "checklist" ? null : result.estimate;
}
