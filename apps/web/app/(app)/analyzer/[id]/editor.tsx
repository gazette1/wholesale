"use client";
import { useMemo, useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { DealInput, RehabLine } from "@dealcalc/engine";
import { runDeal, type DealOutputs } from "@/lib/deal-run";
import { saveAnalysis } from "@/lib/actions/analyzer";
import type { ActionResult } from "@/lib/actions/leads";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { Outputs } from "./outputs";
import { cn, money } from "@/lib/utils";

type PropertyLite = { id: string; sqft: number | null; condition: string; occupancy: string; propertyType: string | null; state: string; county: string | null; postalCode: string };
type ReportLite = { avm: number | null; arv: number | null; rent: number | null; payoff: number; taxAmount: number | null } | null;
export type Sibling = { id: string; version: number; name: string; status: string; outputs: DealOutputs | Record<string, never>; inputs: DealInput };

export function Editor({ analysisId, initialInputs, name: initialName, notes: initialNotes, locked, property, report, comps, siblings, initialTab, canDelete, deleteAction }: {
  analysisId: string; initialInputs: DealInput; name: string; notes: string; locked: boolean; property: PropertyLite; report: ReportLite;
  comps: { address: string; soldPrice: number | null; sqft: number | null; distanceMi: number | null }[]; siblings: Sibling[]; initialTab?: string; canDelete: boolean; deleteAction: () => Promise<ActionResult | never>;
}) {
  const [inputs, setInputs] = useState<DealInput>(initialInputs);
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [section, setSection] = useState<"deal" | "rehab" | "financing" | "holding" | "costs" | "rental">("deal");
  const router = useRouter();

  const outputs = useMemo(() => { try { return { ok: true as const, value: runDeal(inputs, { sensitivity: true }) }; } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; } }, [inputs]);

  const acq = inputs.acquisitions;
  const ws = inputs.wholesale ?? { arv: acq.arv, repairCosts: 0, assignmentFee: Math.abs(acq.assignmentFee), purchasePrice: acq.purchasePrice, investorBuyPrice: null, closingCosts: 0, holdingCosts: 0, existingMortgagePayoff: 0, sellerClosingCosts: 0 };
  const bh = inputs.buyAndHold;

  const setAcq = useCallback(<K extends keyof DealInput["acquisitions"]>(key: K, value: DealInput["acquisitions"][K]) => { setDirty(true); setInputs((prev) => ({ ...prev, acquisitions: { ...prev.acquisitions, [key]: value } })); }, []);
  const setWs = useCallback((key: string, value: number | null) => { setDirty(true); setInputs((prev) => ({ ...prev, wholesale: { ...(prev.wholesale ?? ws), [key]: value } as any })); }, [ws]);
  const setBh = useCallback((key: string, value: any) => { setDirty(true); setInputs((prev) => (prev.buyAndHold ? { ...prev, buyAndHold: { ...prev.buyAndHold, [key]: value } } : prev)); }, []);
  const setLine = useCallback((row: number, patch: Partial<RehabLine>) => { setDirty(true); setInputs((prev) => ({ ...prev, rehab: { ...prev.rehab, lines: prev.rehab.lines.map((l) => (l.row === row ? { ...l, ...patch } : l)) } })); }, []);

  function save() {
    start(async () => {
      const res = await saveAnalysis(analysisId, { inputs, name, notes });
      setFlash(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error });
      if (res.ok) { setDirty(false); router.refresh(); }
      setTimeout(() => setFlash(null), 3000);
    });
  }

  const N = ({ label, value, onChange, step = 1, hint, pct, min, max, disabled }: { label: string; value: number | null | undefined; onChange: (v: number) => void; step?: number; hint?: string; pct?: boolean; min?: number; max?: number; disabled?: boolean }) => (
    <Field label={label} hint={hint}>
      <div className="relative">
        {pct ? null : <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-fg-3">$</span>}
        <Input type="number" step={pct ? 0.01 : step} min={min} max={max} disabled={locked || disabled} value={value == null ? "" : pct ? Number((value * 100).toFixed(4)) : value} onChange={(e) => onChange(pct ? Number(e.target.value) / 100 : Number(e.target.value))} className={pct ? "pr-6" : "pl-5"} />
        {pct ? <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-fg-3">%</span> : null}
      </div>
    </Field>
  );

  const sectionBtn = (key: typeof section, label: string) => (
    <button key={key} type="button" onClick={() => setSection(key)} className={cn("px-2.5 py-1.5 text-[13px] rounded-md whitespace-nowrap", section === key ? "bg-black/[0.06] font-medium" : "text-fg-3 hover:text-fg")}>{label}</button>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <div className="xl:col-span-2 space-y-3">
        <Card>
          <CardHeader title={<input value={name} disabled={locked} onChange={(e) => { setName(e.target.value); setDirty(true); }} className="bg-transparent font-semibold text-[13px] focus:outline-none border-b border-transparent focus:border-border w-full" />} description={locked ? "Locked. Clone to edit." : dirty ? "Unsaved changes" : "All changes recalculate instantly"} actions={!locked ? <Button variant="primary" size="sm" loading={pending} onClick={save} disabled={!dirty && !pending}>Save</Button> : null} />
          <div className="flex gap-1 px-2 py-1.5 border-b border-border overflow-x-auto scrollbar-thin">
            {sectionBtn("deal", "Deal")}{sectionBtn("rehab", "Rehab")}{sectionBtn("financing", "Financing")}{sectionBtn("holding", "Holding")}{sectionBtn("costs", "Closing costs")}{sectionBtn("rental", "Buy and hold")}
          </div>
          <CardBody className="space-y-3 max-h-[70vh] overflow-y-auto scrollbar-thin">
            {flash ? <Alert tone={flash.ok ? "good" : "bad"}>{flash.text}</Alert> : null}
            {section === "deal" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <N label="After repair value" value={acq.arv} onChange={(v) => { setAcq("arv", v); setWs("arv", v); }} step={1000} hint="Value after repairs, from comps" />
                  <N label="Proposed offer" value={acq.purchasePrice} onChange={(v) => { setAcq("purchasePrice", v); setWs("purchasePrice", v); if (acq.firstLienAmount === acq.purchasePrice) setAcq("firstLienAmount", v); }} step={1000} />
                  <N label="As is value" value={acq.asIsValue} onChange={(v) => setAcq("asIsValue", v)} step={1000} hint="Tax base for holding costs" />
                  <N label="Hold months" value={acq.holdMonths} onChange={(v) => setAcq("holdMonths", v)} step={1} min={0} max={9} hint="Flip timeline. The cash flow grid covers up to 9 months." />
                  <N label="Assignment fee or target margin" value={ws.assignmentFee} onChange={(v) => { setWs("assignmentFee", v); setAcq("assignmentFee", -Math.abs(v)); }} step={500} />
                  <N label="ARV factor" value={acq.arvFactor ?? 0.7} onChange={(v) => setAcq("arvFactor", v)} pct hint="70% rule by default" />
                  <N label="Investor buy price" value={ws.investorBuyPrice ?? null} onChange={(v) => setWs("investorBuyPrice", v || null)} step={1000} hint="Leave blank to use ARV factor minus repairs" />
                  <N label="Existing mortgage payoff" value={ws.existingMortgagePayoff ?? 0} onChange={(v) => setWs("existingMortgagePayoff", v)} step={1000} hint="Seller must net at least this" />
                  <N label="Wholesale closing costs" value={ws.closingCosts ?? 0} onChange={(v) => setWs("closingCosts", v)} step={100} />
                  <N label="Seller closing costs" value={ws.sellerClosingCosts ?? 0} onChange={(v) => setWs("sellerClosingCosts", v)} step={100} />
                </div>
                {report ? (
                  <div className="rounded-md border border-border bg-surface-2 p-2.5 text-xs text-fg-2 space-y-1">
                    <div className="font-medium text-fg">From the property report</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {report.avm != null ? <button type="button" className="hover:text-brand" onClick={() => setAcq("asIsValue", report.avm!)}>AVM {money(report.avm)}</button> : null}
                      {report.arv != null ? <button type="button" className="hover:text-brand" onClick={() => { setAcq("arv", report.arv!); setWs("arv", report.arv!); }}>ARV {money(report.arv)}</button> : null}
                      {report.payoff ? <button type="button" className="hover:text-brand" onClick={() => setWs("existingMortgagePayoff", report.payoff)}>Payoff {money(report.payoff)}</button> : null}
                      {report.rent != null ? <span>Rent est. {money(report.rent)}</span> : null}
                    </div>
                    {comps.length ? <div className="text-fg-3">Comps: {comps.slice(0, 3).map((c) => `${money(c.soldPrice)}${c.sqft ? ` (${money((c.soldPrice ?? 0) / c.sqft)}/sf)` : ""}`).join(", ")}</div> : null}
                  </div>
                ) : null}
                <Field label="Notes and supporting comps"><Textarea value={notes} disabled={locked} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="Why this ARV, which comps, what the buyer said" /></Field>
              </>
            ) : null}

            {section === "rehab" ? (
              <>
                <div className="flex items-center justify-between text-[13px]">
                  <span>Checklist total <b className="num">{money(outputs.ok ? outputs.value.rehab.total : 0)}</b></span>
                  <label className="flex items-center gap-2 text-xs text-fg-3">Override
                    <Input type="number" step={500} className="w-28" disabled={locked} value={acq.repairCostsOverride ?? ""} placeholder="none" onChange={(e) => setAcq("repairCostsOverride", e.target.value === "" ? null : Number(e.target.value))} />
                  </label>
                </div>
                <div className="divide-y divide-border/70 border border-border rounded-md">
                  {inputs.rehab.lines.map((l) => (
                    <div key={l.row} className={cn("grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center px-2 py-1.5 text-[13px]", l.itemNumber ? "bg-surface-2/60" : "")}>
                      <div className="min-w-0">
                        {l.itemNumber ? <div className="text-[11px] uppercase tracking-wide text-fg-3">{l.itemNumber}. {l.question}</div> : null}
                        <div className="truncate" title={l.option ?? ""}>{l.option}</div>
                      </div>
                      <select value={l.answer ?? ""} disabled={locked || l.unitCost == null} onChange={(e) => setLine(l.row, { answer: (e.target.value || null) as any })} className="h-7 rounded border border-border bg-surface px-1 text-xs"><option value="">n/a</option><option value="No">No</option><option value="Yes">Yes</option></select>
                      <input type="number" value={l.quantity ?? ""} disabled={locked} onChange={(e) => setLine(l.row, { quantity: e.target.value === "" ? null : Number(e.target.value) })} className="h-7 w-16 rounded border border-border bg-surface px-1 text-xs text-right num" title="Quantity" />
                      <input type="number" value={l.unitCost ?? ""} disabled={locked} onChange={(e) => setLine(l.row, { unitCost: e.target.value === "" ? null : Number(e.target.value) })} className="h-7 w-20 rounded border border-border bg-surface px-1 text-xs text-right num" title="Unit cost" />
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {section === "financing" ? (
              <div className="grid grid-cols-2 gap-3">
                <N label="First lien amount" value={acq.firstLienAmount} onChange={(v) => setAcq("firstLienAmount", v)} step={1000} />
                <N label="First lien points" value={acq.firstPointsRate} onChange={(v) => setAcq("firstPointsRate", v)} pct />
                <N label="First lien interest (annual, paid at close)" value={acq.firstInterestRate} onChange={(v) => setAcq("firstInterestRate", v)} pct />
                <N label="First lien interest only (monthly)" value={acq.firstMonthlyInterestOnlyRate} onChange={(v) => setAcq("firstMonthlyInterestOnlyRate", v)} pct hint="14% per year is 1.1667% per month" />
                <N label="Second lien amount" value={acq.secondLienAmount} onChange={(v) => setAcq("secondLienAmount", v)} step={1000} />
                <N label="Second lien points" value={acq.secondPointsRate} onChange={(v) => setAcq("secondPointsRate", v)} pct />
                <N label="Second lien interest" value={acq.secondInterestRate} onChange={(v) => setAcq("secondInterestRate", v)} pct />
                <N label="Second lien interest only (monthly)" value={acq.secondMonthlyInterestOnlyRate} onChange={(v) => setAcq("secondMonthlyInterestOnlyRate", v)} pct />
                <N label="Misc lien paid" value={acq.miscLienAmountPaid} onChange={(v) => setAcq("miscLienAmountPaid", v)} step={100} />
                <N label="Misc points paid" value={acq.miscPointsPaid} onChange={(v) => setAcq("miscPointsPaid", v)} step={100} />
                <N label="Misc interest paid" value={acq.miscInterestPaid} onChange={(v) => setAcq("miscInterestPaid", v)} step={100} />
                <N label="Misc financing costs" value={acq.miscFinancingCosts} onChange={(v) => setAcq("miscFinancingCosts", v)} step={100} />
              </div>
            ) : null}

            {section === "holding" ? (
              <div className="grid grid-cols-2 gap-3">
                <N label="Property tax rate (annual, on as is value)" value={acq.propertyTaxRate} onChange={(v) => setAcq("propertyTaxRate", v)} pct />
                <N label="HOA per month" value={acq.hoaMonthly} onChange={(v) => setAcq("hoaMonthly", v)} step={25} />
                <N label="Insurance per month" value={acq.insuranceMonthly} onChange={(v) => setAcq("insuranceMonthly", v)} step={25} />
                <N label="Utilities per month (combined)" value={acq.utilitiesMonthly} onChange={(v) => setAcq("utilitiesMonthly", v)} step={25} />
                <N label="Gas per month" value={acq.gasMonthly} onChange={(v) => setAcq("gasMonthly", v)} step={10} />
                <N label="Water per month" value={acq.waterMonthly} onChange={(v) => setAcq("waterMonthly", v)} step={10} />
                <N label="Electricity per month" value={acq.electricityMonthly} onChange={(v) => setAcq("electricityMonthly", v)} step={10} />
                <N label="Misc utilities per month" value={acq.miscUtilitiesMonthly} onChange={(v) => setAcq("miscUtilitiesMonthly", v)} step={10} />
                {acq.miscHoldingMonthly.map((m, i) => <N key={i} label={`Misc holding ${i + 1} per month`} value={m} onChange={(v) => setAcq("miscHoldingMonthly", acq.miscHoldingMonthly.map((x, j) => (j === i ? v : x)) as any)} step={25} />)}
              </div>
            ) : null}

            {section === "costs" ? (
              <div className="grid grid-cols-2 gap-3">
                <N label="Buy: escrow or attorney" value={acq.buyEscrowRate} onChange={(v) => setAcq("buyEscrowRate", v)} pct />
                <N label="Buy: title" value={acq.buyTitleRate} onChange={(v) => setAcq("buyTitleRate", v)} pct />
                <N label="Buy: misc" value={acq.buyMiscRate} onChange={(v) => setAcq("buyMiscRate", v)} pct />
                <N label="Sell: escrow or attorney" value={acq.sellEscrowRate} onChange={(v) => setAcq("sellEscrowRate", v)} pct />
                <N label="Sell: recording" value={acq.sellRecordingRate} onChange={(v) => setAcq("sellRecordingRate", v)} pct />
                <N label="Sell: realtor" value={acq.sellRealtorRate} onChange={(v) => setAcq("sellRealtorRate", v)} pct />
                <N label="Sell: transfer" value={acq.sellTransferRate} onChange={(v) => setAcq("sellTransferRate", v)} pct />
                <N label="Home warranty" value={acq.sellHomeWarranty} onChange={(v) => setAcq("sellHomeWarranty", v)} step={100} />
                <N label="Staging" value={acq.sellStaging} onChange={(v) => setAcq("sellStaging", v)} step={100} />
                <N label="Marketing" value={acq.sellMarketing} onChange={(v) => setAcq("sellMarketing", v)} step={100} />
                <N label="Misc selling" value={acq.sellMisc} onChange={(v) => setAcq("sellMisc", v)} step={100} />
                <p className="col-span-2 text-xs text-fg-3">Percent bases follow the workbook (buying costs on ARV, recording and realtor on the offer) until the anomaly flags are switched. See docs.</p>
              </div>
            ) : null}

            {section === "rental" && bh ? (
              <div className="grid grid-cols-2 gap-3">
                <N label="Purchase price" value={bh.salePrice} onChange={(v) => setBh("salePrice", v)} step={1000} />
                <N label="Down payment" value={bh.downPaymentPct} onChange={(v) => setBh("downPaymentPct", v)} pct />
                <N label="Interest rate" value={bh.interestRate} onChange={(v) => setBh("interestRate", v)} pct />
                <N label="Term years" value={bh.loanTermYears} onChange={(v) => setBh("loanTermYears", v)} step={1} />
                <N label="Closing costs" value={bh.closingCosts} onChange={(v) => setBh("closingCosts", v)} step={500} />
                <N label="Property tax per year" value={bh.propertyTaxYear} onChange={(v) => setBh("propertyTaxYear", v)} step={100} />
                <N label="Insurance per month" value={bh.insuranceMonth} onChange={(v) => setBh("insuranceMonth", v)} step={10} />
                <N label="Owner paid utilities per month" value={bh.gasElectricMonth} onChange={(v) => setBh("gasElectricMonth", v)} step={10} />
                <N label="Management" value={bh.managementPct} onChange={(v) => setBh("managementPct", v)} pct />
                <N label="Vacancy" value={bh.vacancyPct} onChange={(v) => setBh("vacancyPct", v)} pct />
                <N label="Maintenance" value={bh.maintenancePct} onChange={(v) => setBh("maintenancePct", v)} pct />
                <N label="Appreciation per year" value={bh.appreciationRate} onChange={(v) => setBh("appreciationRate", v)} pct />
                <N label="Rent growth per year" value={bh.rentGrowthRate} onChange={(v) => setBh("rentGrowthRate", v)} pct />
                <N label="Marginal tax rate" value={bh.marginalTaxRate} onChange={(v) => setBh("marginalTaxRate", v)} pct />
                <div className="col-span-2 space-y-1.5">
                  <div className="text-xs font-medium text-fg-2">Units (current rent, market rent)</div>
                  {bh.units.map((u, i) => (
                    <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center">
                      <span className="text-xs text-fg-3 w-10">#{i + 1}</span>
                      <Input type="number" step={25} value={u.rent ?? ""} disabled={locked} onChange={(e) => setBh("units", bh.units.map((x, j) => (j === i ? { ...x, rent: Number(e.target.value) } : x)))} placeholder="Rent" />
                      <Input type="number" step={25} value={u.marketRent ?? ""} disabled={locked} onChange={(e) => setBh("units", bh.units.map((x, j) => (j === i ? { ...x, marketRent: Number(e.target.value) } : x)))} placeholder="Market" />
                      <button type="button" disabled={locked || bh.units.length === 1} onClick={() => setBh("units", bh.units.filter((_, j) => j !== i))} className="text-xs text-fg-3 hover:text-bad disabled:opacity-40">Remove</button>
                    </div>
                  ))}
                  {bh.units.length < 20 ? <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => setBh("units", [...bh.units, { unit: bh.units.length + 1, beds: null, baths: null, rent: 0, marketRent: 0 }])}>Add unit</Button> : null}
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
        {canDelete ? <form action={deleteAction as any} onSubmit={(e) => { if (!window.confirm("Delete this analysis version?")) e.preventDefault(); }}><Button type="submit" variant="ghost" size="sm" className="text-bad">Delete version</Button></form> : null}
      </div>

      <div className="xl:col-span-3 min-w-0">
        {outputs.ok ? <Outputs outputs={outputs.value} inputs={inputs} siblings={siblings} currentId={analysisId} initialTab={initialTab} /> : <Alert tone="bad">{outputs.error}</Alert>}
      </div>
    </div>
  );
}
