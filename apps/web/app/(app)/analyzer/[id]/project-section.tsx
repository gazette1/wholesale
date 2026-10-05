"use client";
import { emptyProjectModel, type DealInput, type ProjectModelInput, type FeeItem, type FinancingLoan, type MonthlyCost, type DrawTranche, type RehabExpenseEvent, type CashAdjustment, type RentalProjectionAssumptions } from "@dealcalc/engine";
import { Button } from "@/components/ui/button";
import { Input, Field, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { NumField, Segmented, SectionTitle, useLocked } from "./fields";
import type { Patch } from "./sections";
import { money } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";

const BASIS_LABEL: Record<FeeItem["basis"], string> = { fixed: "Fixed amount", pctPurchase: "% of purchase", pctSale: "% of sale", pctAsIs: "% of as is value" };
const NEW_LOAN: FinancingLoan = { name: "", purchaseFunding: 0, rehabFunding: 0, annualRate: 0.12, points: 0.02, fixedFees: 0, interestBasis: "fullCommitment" };
const NEW_FEE: FeeItem = { name: "", value: 0, basis: "fixed" };
const NEW_COST: MonthlyCost = { name: "", amount: 0 };
const NEW_DRAW: DrawTranche = { timingPercent: 0.5, fundingPercent: 0.5 };
const DEFAULT_PROJECTION: RentalProjectionAssumptions = { years: 20, ownerFundedRehab: 0, depreciableBasis: 0, depreciationYears: 27.5, marginalTaxRate: 0.24 };
const NEW_REHAB_EVENT: RehabExpenseEvent = { date: "", amount: 0 };
const NEW_CASH_EVENT: CashAdjustment = { name: "", date: "", amount: 0 };

/** New dated rows open on the project start date so they land inside the hold. */
const startOr = (startDate: string | null | undefined) => startDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

type ListKey = "loans" | "buyingFees" | "sellingFees" | "holdingCosts" | "upfrontDraws" | "delayedDraws" | "rehabExpenseEvents" | "customCashEvents";

/**
 * Inputs for the second financing model from the Mac app. Off by default. It never changes the Flip P&L,
 * the offers, or the workbook cash flow: see docs/MAC_PARITY.md, "Project model".
 */
export function ProjectSection({ inputs, patch }: { inputs: DealInput; patch: Patch }) {
  const locked = useLocked();
  const project = inputs.project;
  const set = (p: Partial<ProjectModelInput>) => patch((prev) => ({ ...prev, project: { ...(prev.project ?? emptyProjectModel()), ...p } }));
  function setRow<K extends ListKey>(key: K, index: number, row: Partial<ProjectModelInput[K][number]>) {
    patch((prev) => {
      const current = prev.project ?? emptyProjectModel();
      const list = current[key].map((item, i) => (i === index ? { ...item, ...row } : item)) as ProjectModelInput[K];
      return { ...prev, project: { ...current, [key]: list } };
    });
  }
  function addRow<K extends ListKey>(key: K, row: ProjectModelInput[K][number]) {
    patch((prev) => { const current = prev.project ?? emptyProjectModel(); return { ...prev, project: { ...current, [key]: [...current[key], row] } }; });
  }
  function removeRow(key: ListKey, index: number) {
    patch((prev) => { const current = prev.project ?? emptyProjectModel(); return { ...prev, project: { ...current, [key]: current[key].filter((_, i) => i !== index) } }; });
  }

  if (!project) {
    return (
      <div className="space-y-3">
        <SectionTitle note="A second way to model financing and costs, taken from the Mac app: any number of loans, fee lines with a basis, and free form monthly holding lines.">Project model (preview)</SectionTitle>
        <Alert tone="info">Off for this analysis. Turning it on adds a Project model results tab. It does not change the offers, the Flip P&L, or the workbook cash flow, which stay tied to the spreadsheet.</Alert>
        <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => set({})}>Turn on the project model</Button>
      </div>
    );
  }

  const setProjection = (p: Partial<RentalProjectionAssumptions>) => patch((prev) => {
    const current = prev.project ?? emptyProjectModel();
    return { ...prev, project: { ...current, rentalProjection: { ...(current.rentalProjection ?? DEFAULT_PROJECTION), ...p } } };
  });
  const draws = project.drawMode === "upfront" ? "upfrontDraws" : "delayedDraws";
  const rehabScheduled = project.rehabExpenseEvents.reduce((a, e) => a + e.amount, 0);
  return (
    <div className="space-y-4">
      <SectionTitle note="Preview. These inputs feed the Project model tab only. The dated parts of the model need a start date.">Project model (preview)</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" hint="Needed for dated expenses"><Input type="date" aria-label="Project start date" disabled={locked} value={project.startDate?.slice(0, 10) ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} /></Field>
        <NumField label="Initial owner cash" value={project.initialCash ?? 0} step={1000} min={0} onChange={(v) => set({ initialCash: v })} />
      </div>

      <div className="space-y-2">
        <SectionTitle note="Points are charged on the commitment. Monthly interest is the annual rate divided by 12, charged at each month start.">Loans</SectionTitle>
        {project.loans.length === 0 ? <p className="text-xs text-fg-3">No loans. The purchase is modeled as all cash.</p> : null}
        {project.loans.map((loan, i) => (
          <div key={i} className="rounded-md border border-border p-2 space-y-2">
            <div className="flex items-end gap-2">
              <Field label="Loan name" className="flex-1"><Input aria-label={`Loan ${i + 1} name`} disabled={locked} maxLength={80} value={loan.name} onChange={(e) => setRow("loans", i, { name: e.target.value })} /></Field>
              <Button type="button" variant="ghost" size="sm" disabled={locked} aria-label={`Remove loan ${i + 1}`} onClick={() => removeRow("loans", i)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Purchase funding" ariaLabel={`Loan ${i + 1} purchase funding`} value={loan.purchaseFunding} step={1000} min={0} onChange={(v) => setRow("loans", i, { purchaseFunding: v })} />
              <NumField label="Rehab funding" ariaLabel={`Loan ${i + 1} rehab funding`} value={loan.rehabFunding} step={1000} min={0} onChange={(v) => setRow("loans", i, { rehabFunding: v })} />
              <NumField label="Annual rate" ariaLabel={`Loan ${i + 1} annual rate`} pct value={loan.annualRate} min={0} max={50} onChange={(v) => setRow("loans", i, { annualRate: v })} />
              <NumField label="Points" ariaLabel={`Loan ${i + 1} points`} pct value={loan.points} min={0} max={15} onChange={(v) => setRow("loans", i, { points: v })} />
              <NumField label="Fixed fees" ariaLabel={`Loan ${i + 1} fixed fees`} value={loan.fixedFees} step={100} min={0} onChange={(v) => setRow("loans", i, { fixedFees: v })} />
              <Field label="Interest charged on"><Segmented label={`Loan ${i + 1} interest basis`} value={loan.interestBasis} options={[{ key: "fullCommitment", label: "Full commitment" }, { key: "drawnBalance", label: "Drawn balance" }]} onChange={(v) => setRow("loans", i, { interestBasis: v })} /></Field>
            </div>
            {loan.interestBasis === "drawnBalance" && !project.startDate ? <p className="text-xs text-warn">Interest on the drawn balance reads the debt at each month start, so it needs a project start date.</p> : null}
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" disabled={locked || project.loans.length >= 6} onClick={() => addRow("loans", { ...NEW_LOAN, name: `Loan ${project.loans.length + 1}` })}><Plus className="h-3.5 w-3.5" />Add loan</Button>
      </div>

      {([["buyingFees", "Buying fees"], ["sellingFees", "Selling fees"]] as const).map(([key, title]) => (
        <div key={key} className="space-y-2">
          <SectionTitle>{title}</SectionTitle>
          {project[key].map((fee, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_9rem_auto] items-end gap-2">
              <Field label="Name"><Input aria-label={`${title} ${i + 1} name`} disabled={locked} maxLength={80} value={fee.name} onChange={(e) => setRow(key, i, { name: e.target.value })} /></Field>
              {fee.basis === "fixed"
                ? <NumField label="Amount" ariaLabel={`${title} ${i + 1} amount`} value={fee.value} step={50} min={0} onChange={(v) => setRow(key, i, { value: v })} />
                : <NumField label="Percent" ariaLabel={`${title} ${i + 1} percent`} pct value={fee.value} min={0} max={100} onChange={(v) => setRow(key, i, { value: v })} />}
              {/* A percent and a dollar amount share one stored field, so switching the basis starts the value over. */}
              <Field label="Basis"><Select aria-label={`${title} ${i + 1} basis`} disabled={locked} value={fee.basis} onChange={(e) => setRow(key, i, { basis: e.target.value as FeeItem["basis"], value: 0 })}>{Object.entries(BASIS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</Select></Field>
              <Button type="button" variant="ghost" size="sm" disabled={locked} aria-label={`Remove ${title.toLowerCase()} line ${i + 1}`} onClick={() => removeRow(key, i)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" disabled={locked || project[key].length >= 20} onClick={() => addRow(key, NEW_FEE)}><Plus className="h-3.5 w-3.5" />Add fee</Button>
        </div>
      ))}

      <div className="space-y-2">
        <SectionTitle note="Each line is charged at every month start of the hold.">Monthly holding costs</SectionTitle>
        {project.holdingCosts.map((cost, i) => (
          <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
            <Field label="Name"><Input aria-label={`Holding cost ${i + 1} name`} disabled={locked} maxLength={80} value={cost.name} onChange={(e) => setRow("holdingCosts", i, { name: e.target.value })} /></Field>
            <NumField label="Per month" ariaLabel={`Holding cost ${i + 1} per month`} value={cost.amount} step={25} min={0} onChange={(v) => setRow("holdingCosts", i, { amount: v })} />
            <Button type="button" variant="ghost" size="sm" disabled={locked} aria-label={`Remove holding cost ${i + 1}`} onClick={() => removeRow("holdingCosts", i)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" disabled={locked || project.holdingCosts.length >= 30} onClick={() => addRow("holdingCosts", NEW_COST)}><Plus className="h-3.5 w-3.5" />Add monthly cost</Button>
      </div>

      <div className="space-y-2">
        <SectionTitle note="A draw lands at its share of the hold, rounded up to a whole week. It releases that share of each loan's rehab funding and never more than the commitment.">Draws</SectionTitle>
        <Segmented label="Draw mode" value={project.drawMode} options={[{ key: "delayed", label: "Delayed draws" }, { key: "upfront", label: "Up front draws" }]} onChange={(v) => set({ drawMode: v })} />
        {project[draws].map((draw, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <NumField label="Arrives at, % of hold" ariaLabel={`Draw ${i + 1} timing`} pct value={draw.timingPercent} min={0} max={100} onChange={(v) => setRow(draws, i, { timingPercent: v })} />
            <NumField label="Releases, % of rehab funding" ariaLabel={`Draw ${i + 1} funding share`} pct value={draw.fundingPercent} min={0} max={100} onChange={(v) => setRow(draws, i, { fundingPercent: v })} />
            <Button type="button" variant="ghost" size="sm" disabled={locked} aria-label={`Remove draw ${i + 1}`} onClick={() => removeRow(draws, i)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" disabled={locked || project[draws].length >= 12} onClick={() => addRow(draws, NEW_DRAW)}><Plus className="h-3.5 w-3.5" />Add draw</Button>
      </div>

      <div className="space-y-2">
        <SectionTitle note="Off means the rehab is spread evenly across every week of the hold, with the cent adjustment in the final week. On means you date every dollar of it.">Rehab spending schedule</SectionTitle>
        <Segmented label="Rehab spending schedule" value={project.useCustomRehabSchedule ? "custom" : "even"} options={[{ key: "even", label: "Even across the hold" }, { key: "custom", label: "Dated expenses" }]} onChange={(v) => set({ useCustomRehabSchedule: v === "custom" })} />
        {project.useCustomRehabSchedule ? (
          <>
            {project.rehabExpenseEvents.map((event, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
                <Field label="Date"><Input type="date" aria-label={`Rehab expense ${i + 1} date`} disabled={locked} value={event.date.slice(0, 10)} onChange={(e) => setRow("rehabExpenseEvents", i, { date: e.target.value })} /></Field>
                <NumField label="Amount" ariaLabel={`Rehab expense ${i + 1} amount`} value={event.amount} step={500} min={0} onChange={(v) => setRow("rehabExpenseEvents", i, { amount: v })} />
                <Button type="button" variant="ghost" size="sm" disabled={locked} aria-label={`Remove rehab expense ${i + 1}`} onClick={() => removeRow("rehabExpenseEvents", i)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
            <p className="text-xs text-fg-3">Scheduled so far {money(rehabScheduled)}. The dates must fall inside the hold and the total must equal the linked rehab estimate.</p>
            <Button type="button" variant="ghost" size="sm" disabled={locked || project.rehabExpenseEvents.length >= 100} onClick={() => addRow("rehabExpenseEvents", { ...NEW_REHAB_EVENT, date: startOr(project.startDate) })}><Plus className="h-3.5 w-3.5" />Add rehab expense</Button>
          </>
        ) : null}
      </div>

      <div className="space-y-2">
        <SectionTitle note="Anything the weekly cash flow should carry that is not purchase, rehab, holding, financing, or sale. Enter income as a positive number and an expense as a negative one.">Other project cash events</SectionTitle>
        {project.customCashEvents.map((event, i) => (
          <div key={i} className="grid grid-cols-[1fr_9rem_8rem_auto] items-end gap-2">
            <Field label="Name"><Input aria-label={`Cash event ${i + 1} name`} disabled={locked} maxLength={80} value={event.name} onChange={(e) => setRow("customCashEvents", i, { name: e.target.value })} /></Field>
            <Field label="Date"><Input type="date" aria-label={`Cash event ${i + 1} date`} disabled={locked} value={event.date.slice(0, 10)} onChange={(e) => setRow("customCashEvents", i, { date: e.target.value })} /></Field>
            <NumField label="Amount" ariaLabel={`Cash event ${i + 1} amount`} value={event.amount} step={100} onChange={(v) => setRow("customCashEvents", i, { amount: v })} />
            <Button type="button" variant="ghost" size="sm" disabled={locked} aria-label={`Remove cash event ${i + 1}`} onClick={() => removeRow("customCashEvents", i)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" disabled={locked || project.customCashEvents.length >= 100} onClick={() => addRow("customCashEvents", { ...NEW_CASH_EVENT, date: startOr(project.startDate) })}><Plus className="h-3.5 w-3.5" />Add cash event</Button>
      </div>

      <div className="space-y-2">
        <SectionTitle note="A year by year hold projection. It reads the rents, expenses, and loan terms from the Buy and hold section, so that section needs at least one unit.">Rental projection assumptions</SectionTitle>
        <Segmented label="Rental projection" value={project.rentalProjection ? "on" : "off"} options={[{ key: "off", label: "Off" }, { key: "on", label: "On" }]} onChange={(v) => set({ rentalProjection: v === "on" ? DEFAULT_PROJECTION : null })} />
        {project.rentalProjection ? (
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Years" value={project.rentalProjection.years} step={1} min={1} max={40} integer plain onChange={(v) => setProjection({ years: Math.min(40, Math.max(1, Math.round(v) || 1)) })} />
            <NumField label="Owner funded initial rehab" hint="Part of the return denominator" value={project.rentalProjection.ownerFundedRehab} step={1000} min={0} onChange={(v) => setProjection({ ownerFundedRehab: v })} />
            <NumField label="Depreciable basis" hint="Building value, land excluded" value={project.rentalProjection.depreciableBasis} step={5000} min={0} onChange={(v) => setProjection({ depreciableBasis: v })} />
            <NumField label="Depreciation years" value={project.rentalProjection.depreciationYears} step={0.5} min={1} max={50} plain onChange={(v) => setProjection({ depreciationYears: Math.min(50, Math.max(1, v || 1)) })} />
            <NumField label="Marginal tax rate" pct value={project.rentalProjection.marginalTaxRate} min={0} max={100} onChange={(v) => setProjection({ marginalTaxRate: v })} />
          </div>
        ) : null}
      </div>

      <div className="pt-1 border-t border-border">
        <Button type="button" variant="ghost" size="sm" className="text-bad" disabled={locked} onClick={() => { if (window.confirm("Turn the project model off and clear its inputs for this version?")) patch((prev) => { const { project: _removed, ...rest } = prev; return rest as DealInput; }); }}>Turn off and clear</Button>
      </div>
    </div>
  );
}
