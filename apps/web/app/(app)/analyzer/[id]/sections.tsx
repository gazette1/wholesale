"use client";
import { useState } from "react";
import type { DealInput, RehabLine, DealOutputs } from "@dealcalc/engine";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { NumField, Segmented, SectionTitle, useLocked } from "./fields";
import { cn, money, percent } from "@/lib/utils";
import { Plus, Trash2, StickyNote } from "lucide-react";

export type Patch = (fn: (prev: DealInput) => DealInput) => void;
type Offers = NonNullable<DealInput["offers"]>;
type SellerCase = NonNullable<Offers["sellerCurrent"]>;

export function defaultOffers(sqft: number): Offers {
  return { comparables: [], useComparableAverage: false, squareFeet: sqft, perSqft: { light: 15, medium: 30, full: 50 }, sellerCurrent: null, sellerDesired: null };
}

/* ------------------------------------------------------------------ Offers */

export function OffersSection({ inputs, patch, outputs, sqft, reportComps }: { inputs: DealInput; patch: Patch; outputs: DealOutputs | null; sqft: number; reportComps: { address: string; soldPrice: number | null }[] }) {
  const locked = useLocked();
  const o = inputs.offers ?? defaultOffers(sqft);
  const set = (fn: (o: Offers) => Offers) => patch((prev) => ({ ...prev, offers: fn(prev.offers ?? defaultOffers(sqft)) }));
  const avg = outputs?.offers.comparableAverage ?? null;
  const missing = reportComps.filter((c) => (c.soldPrice ?? 0) > 0 && !o.comparables.some((x) => x.label === c.address.slice(0, 120)));
  const setCase = (key: "sellerCurrent" | "sellerDesired", fn: (c: SellerCase) => SellerCase) => set((x) => ({ ...x, [key]: fn(x[key] ?? { outcome: inputs.acquisitions.purchasePrice, effort: 1, months: 1, probability: 0.9 }) }));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SectionTitle note="Sold prices of similar homes. Turn on the switch to use their average as the after repair value everywhere in this analysis.">Comparable sales</SectionTitle>
        {o.comparables.length === 0 ? <p className="text-xs text-fg-3">No comparables yet.</p> : null}
        {o.comparables.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_130px_auto] gap-2 items-center">
            <Input value={c.label} disabled={locked} maxLength={120} placeholder="Address or note" aria-label={`Comparable ${i + 1} label`} onChange={(e) => set((x) => ({ ...x, comparables: x.comparables.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) }))} />
            <Input type="number" step={1000} value={c.value || ""} disabled={locked} placeholder="Sold price" aria-label={`Comparable ${i + 1} sold price`} onChange={(e) => set((x) => ({ ...x, comparables: x.comparables.map((y, j) => (j === i ? { ...y, value: Number(e.target.value) || 0 } : y)) }))} />
            <button type="button" disabled={locked} aria-label={`Remove comparable ${i + 1}`} onClick={() => set((x) => ({ ...x, comparables: x.comparables.filter((_, j) => j !== i) }))} className="p-1.5 rounded text-fg-3 hover:text-bad hover:bg-black/5 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={locked || o.comparables.length >= 12} onClick={() => set((x) => ({ ...x, comparables: [...x.comparables, { label: "", value: 0 }] }))}><Plus className="h-3.5 w-3.5" />Add comparable</Button>
          {missing.length ? <Button type="button" variant="ghost" size="sm" disabled={locked || o.comparables.length >= 12} onClick={() => set((x) => ({ ...x, comparables: [...x.comparables, ...missing.slice(0, 12 - x.comparables.length).map((c) => ({ label: c.address.slice(0, 120), value: c.soldPrice ?? 0 }))] }))}>Add {missing.length} from the property report</Button> : null}
        </div>
        <label className="flex items-start gap-2 text-[13px] pt-1">
          <input type="checkbox" className="mt-0.5" disabled={locked} checked={o.useComparableAverage} onChange={(e) => set((x) => ({ ...x, useComparableAverage: e.target.checked }))} />
          <span>Use the comparable average as ARV{avg != null ? <span className="text-fg-3"> ({money(avg)} from {outputs?.offers.comparableCount})</span> : null}
            {o.useComparableAverage && avg != null ? <span className="block text-xs text-fg-3">The ARV typed on the Deal section ({money(inputs.acquisitions.arv)}) is set aside while this is on.</span> : null}
          </span>
        </label>
      </div>

      <div className="space-y-2">
        <SectionTitle note="Three rehab levels priced per square foot. Each offer is ARV times the offer percent, less the fee, less that level of repairs.">Quick offer tiers</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Square feet" plain value={o.squareFeet} step={50} min={0} onChange={(v) => set((x) => ({ ...x, squareFeet: v }))} />
          <NumField label="Offer percent of ARV" pct value={inputs.acquisitions.arvFactor ?? 0.7} onChange={(v) => patch((p) => ({ ...p, acquisitions: { ...p.acquisitions, arvFactor: v } }))} hint="70% rule by default" />
          <NumField label="Light rehab per sq ft" value={o.perSqft.light} step={1} min={0} onChange={(v) => set((x) => ({ ...x, perSqft: { ...x.perSqft, light: v } }))} />
          <NumField label="Medium rehab per sq ft" value={o.perSqft.medium} step={1} min={0} onChange={(v) => set((x) => ({ ...x, perSqft: { ...x.perSqft, medium: v } }))} />
          <NumField label="Full rehab per sq ft" value={o.perSqft.full} step={1} min={0} onChange={(v) => set((x) => ({ ...x, perSqft: { ...x.perSqft, full: v } }))} />
        </div>
      </div>

      <div className="space-y-2">
        <SectionTitle note="Compares what the seller has now with what your offer gives them. Score is outcome times probability, divided by months times effort. A comparison score, not an appraisal.">Seller value comparison</SectionTitle>
        {(["sellerCurrent", "sellerDesired"] as const).map((key) => {
          const c = o[key];
          const title = key === "sellerCurrent" ? "Seller's current path" : "With your offer";
          return (
            <div key={key} className="rounded-md border border-border p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{title}</span>
                {c ? <button type="button" disabled={locked} className="text-xs text-fg-3 hover:text-bad disabled:opacity-40" onClick={() => set((x) => ({ ...x, [key]: null }))}>Clear</button>
                  : <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => setCase(key, (x) => x)}>Add case</Button>}
              </div>
              {c ? (
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Outcome for the seller" value={c.outcome} step={1000} onChange={(v) => setCase(key, (x) => ({ ...x, outcome: v }))} />
                  <NumField label="Probability of sale" pct value={c.probability} min={0} max={100} onChange={(v) => setCase(key, (x) => ({ ...x, probability: Math.min(1, Math.max(0, v)) }))} />
                  <NumField label="Months to close" plain value={c.months} step={0.5} min={0} onChange={(v) => setCase(key, (x) => ({ ...x, months: v }))} />
                  <NumField label="Effort (1 low to 10 high)" plain value={c.effort} step={1} min={0} max={10} onChange={(v) => setCase(key, (x) => ({ ...x, effort: v }))} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Rehab */

const STATUS_LABEL: Record<string, string> = { todo: "To do", in_progress: "In progress", done: "Done" };

export function RehabSection({ inputs, patch, outputs, sqft }: { inputs: DealInput; patch: Patch; outputs: DealOutputs | null; sqft: number }) {
  const locked = useLocked();
  const [onlyIncluded, setOnlyIncluded] = useState(false);
  const [openNotes, setOpenNotes] = useState<number | null>(null);
  const [progressText, setProgressText] = useState("");
  const plan = inputs.rehabPlan ?? { source: inputs.acquisitions.repairCostsOverride != null ? ("manual" as const) : ("checklist" as const), perSqftRate: 30, squareFeet: sqft };
  const setPlan = (p: Partial<typeof plan>) => patch((prev) => ({ ...prev, rehabPlan: { ...plan, ...(prev.rehabPlan ?? {}), ...p } }));
  const setLine = (row: number, p: Partial<RehabLine>) => patch((prev) => ({ ...prev, rehab: { ...prev.rehab, lines: prev.rehab.lines.map((l) => (l.row === row ? { ...l, ...p } : l)) } }));
  const lines = inputs.rehab.lines.filter((l) => !onlyIncluded || l.answer === "Yes");
  const r = outputs?.rehabPlan;
  const today = new Date().toISOString().slice(0, 10);

  function addCustom() {
    patch((prev) => {
      const next = Math.max(1000, ...prev.rehab.lines.map((l) => l.row + 1));
      return { ...prev, rehab: { ...prev.rehab, lines: [...prev.rehab.lines, { row: next, itemNumber: null, question: null, option: "Custom item", answer: "Yes", quantity: 1, unitCost: 0, status: "todo", notes: null, custom: true }] } };
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <SectionTitle>Repair estimate source</SectionTitle>
          <Segmented label="Repair estimate source" value={plan.source} onChange={(source) => patch((prev) => ({ ...prev, rehabPlan: { ...plan, ...(prev.rehabPlan ?? {}), source }, acquisitions: source === "manual" && prev.acquisitions.repairCostsOverride == null ? { ...prev.acquisitions, repairCostsOverride: Math.round(r?.estimate ?? 0) } : prev.acquisitions }))} options={[{ key: "checklist", label: "Checklist" }, { key: "manual", label: "Manual estimate" }, { key: "perSqft", label: "Per square foot" }]} />
        </div>
        {plan.source === "manual" ? <NumField label="Manual repair estimate" value={inputs.acquisitions.repairCostsOverride ?? 0} step={500} min={0} onChange={(v) => patch((p) => ({ ...p, acquisitions: { ...p.acquisitions, repairCostsOverride: v } }))} hint="This amount drives every calculation. The checklist below still tracks the work." /> : null}
        {plan.source === "perSqft" ? (
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Rehab cost per sq ft" value={plan.perSqftRate ?? 0} step={1} min={0} onChange={(v) => setPlan({ perSqftRate: v })} />
            <NumField label="Square feet" plain value={plan.squareFeet ?? 0} step={50} min={0} onChange={(v) => setPlan({ squareFeet: v })} />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span>Estimate in use <b className="num">{money(r?.estimate ?? 0)}</b></span>
          <span className="text-fg-3">Checklist total <span className="num">{money(r?.checklistTotal ?? 0)}</span></span>
          <span className="text-fg-3">{r?.completedCount ?? 0} of {r?.includedCount ?? 0} items done ({percent(r?.completion ?? 0)})</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-fg-2"><input type="checkbox" checked={onlyIncluded} onChange={(e) => setOnlyIncluded(e.target.checked)} />Show included items only</label>
        <Button type="button" variant="outline" size="sm" disabled={locked} onClick={addCustom}><Plus className="h-3.5 w-3.5" />Add custom item</Button>
      </div>

      <div className="divide-y divide-border/70 border border-border rounded-md">
        <div className="hidden sm:grid grid-cols-[1fr_64px_60px_84px_104px_28px] gap-2 px-2 py-1 text-[11px] uppercase tracking-wide text-fg-3 bg-surface-2/60">
          <span>Item</span><span>Include</span><span className="text-right">Qty</span><span className="text-right">Unit cost</span><span>Status</span><span />
        </div>
        {lines.length === 0 ? <p className="p-3 text-xs text-fg-3">No items are included yet. Clear the filter and mark items Yes.</p> : null}
        {lines.map((l) => {
          const included = l.answer === "Yes";
          const needs = included && (!(Number(l.unitCost) > 0) || !(Number(l.quantity) > 0));
          return (
            <div key={l.row} className={cn("px-2 py-1.5 text-[13px]", l.itemNumber ? "bg-surface-2/40" : "")}>
              <div className="grid grid-cols-[1fr_64px_60px_84px] sm:grid-cols-[1fr_64px_60px_84px_104px_28px] gap-2 items-center">
                <div className="min-w-0">
                  {l.itemNumber ? <div className="text-[11px] uppercase tracking-wide text-fg-3">{l.itemNumber}. {l.question}</div> : null}
                  {l.custom ? <input value={l.option ?? ""} disabled={locked} maxLength={120} aria-label="Custom item name" onChange={(e) => setLine(l.row, { option: e.target.value })} className="w-full bg-transparent border-b border-dashed border-border focus:outline-none focus:border-brand text-[13px]" />
                    : <div className="truncate" title={l.option ?? ""}>{l.option}</div>}
                  {needs ? <div className="text-[11px] text-warn">Needs price or quantity</div> : null}
                </div>
                <select value={l.answer ?? ""} disabled={locked || (l.unitCost == null && !l.custom && l.answer == null)} aria-label={`Include ${l.option ?? "item"}`} onChange={(e) => setLine(l.row, { answer: (e.target.value || null) as RehabLine["answer"] })} className="h-7 rounded border border-border bg-surface px-1 text-xs"><option value="">n/a</option><option value="No">No</option><option value="Yes">Yes</option></select>
                <input type="number" min={0} value={l.quantity ?? ""} disabled={locked} aria-label="Quantity" onChange={(e) => setLine(l.row, { quantity: e.target.value === "" ? null : Number(e.target.value) })} className="h-7 w-full rounded border border-border bg-surface px-1 text-xs text-right num" />
                <input type="number" min={0} value={l.unitCost ?? ""} disabled={locked} aria-label="Unit cost" onChange={(e) => setLine(l.row, { unitCost: e.target.value === "" ? null : Number(e.target.value) })} className="h-7 w-full rounded border border-border bg-surface px-1 text-xs text-right num" />
                <select value={l.status ?? "todo"} disabled={locked || !included} aria-label="Work status" onChange={(e) => setLine(l.row, { status: e.target.value as RehabLine["status"] })} className="hidden sm:block h-7 rounded border border-border bg-surface px-1 text-xs disabled:opacity-40">
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <div className="hidden sm:flex items-center justify-end">
                  {l.custom ? <button type="button" disabled={locked} aria-label="Remove custom item" onClick={() => patch((p) => ({ ...p, rehab: { ...p.rehab, lines: p.rehab.lines.filter((x) => x.row !== l.row) } }))} className="p-1 rounded text-fg-3 hover:text-bad disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
                    : <button type="button" aria-label="Notes" onClick={() => setOpenNotes(openNotes === l.row ? null : l.row)} className={cn("p-1 rounded hover:bg-black/5", l.notes ? "text-brand" : "text-fg-3")}><StickyNote className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
              {openNotes === l.row || (l.custom && included) ? <input value={l.notes ?? ""} disabled={locked} maxLength={500} placeholder="Notes for this item" aria-label="Item notes" onChange={(e) => setLine(l.row, { notes: e.target.value || null })} className="mt-1.5 w-full h-7 rounded border border-border bg-surface px-2 text-xs" /> : null}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <SectionTitle note="A dated log of what happened on site. Completion above counts finished items only. It does not measure money spent.">Progress history</SectionTitle>
        <div className="flex gap-2">
          <Input value={progressText} disabled={locked} maxLength={300} placeholder="Roof tear off started" aria-label="Progress note" onChange={(e) => setProgressText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (progressText.trim()) { patch((p) => ({ ...p, progress: [{ date: today, message: progressText.trim() }, ...(p.progress ?? [])] })); setProgressText(""); } } }} />
          <Button type="button" variant="outline" size="sm" disabled={locked || !progressText.trim()} onClick={() => { patch((p) => ({ ...p, progress: [{ date: today, message: progressText.trim() }, ...(p.progress ?? [])] })); setProgressText(""); }}>Add</Button>
        </div>
        {(inputs.progress ?? []).length === 0 ? <p className="text-xs text-fg-3">No progress entries yet.</p> : (
          <ul className="space-y-1">
            {(inputs.progress ?? []).map((e, i) => (
              <li key={`${e.date}-${i}`} className="flex items-start justify-between gap-2 text-[13px]">
                <span><Badge tone="neutral" className="mr-2">{e.date}</Badge>{e.message}</span>
                <button type="button" disabled={locked} aria-label="Remove progress entry" onClick={() => patch((p) => ({ ...p, progress: (p.progress ?? []).filter((_, j) => j !== i) }))} className="p-1 rounded text-fg-3 hover:text-bad disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- Loan */

export function LoanSection({ inputs, patch }: { inputs: DealInput; patch: Patch }) {
  const locked = useLocked();
  const now = new Date();
  const fallback = { principal: Math.max(1000, Math.round(inputs.acquisitions.purchasePrice * 0.8)), annualRate: 0.075, months: 360, firstPaymentDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1)).toISOString().slice(0, 10), payoffAfterPayment: 60 as number | null };
  const loan = inputs.loan ?? fallback;
  const set = (p: Partial<typeof loan>) => patch((prev) => ({ ...prev, loan: { ...(prev.loan ?? fallback), ...p } }));
  const bh = inputs.buyAndHold;
  return (
    <div className="space-y-3">
      <SectionTitle note="A standalone fixed rate loan schedule. It does not feed the flip or wholesale numbers.">Loan analysis</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Principal" value={loan.principal} step={1000} min={0} onChange={(v) => set({ principal: v })} />
        <NumField label="Annual interest rate" pct value={loan.annualRate} min={0} max={50} onChange={(v) => set({ annualRate: v })} />
        <NumField label="Term in months" plain value={loan.months} step={12} min={1} max={600} onChange={(v) => set({ months: Math.round(v) })} hint="1 to 600" />
        <Field label="First payment date"><Input type="date" disabled={locked} value={loan.firstPaymentDate.slice(0, 10)} onChange={(e) => { if (e.target.value) set({ firstPaymentDate: e.target.value }); }} /></Field>
        <NumField label="Payoff after payment number" plain value={loan.payoffAfterPayment ?? null} step={1} min={1} placeholder="none" onClear={() => set({ payoffAfterPayment: null })} onChange={(v) => set({ payoffAfterPayment: v >= 1 ? Math.round(v) : null })} hint="Shows the balance left after this many payments" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={locked || !(inputs.acquisitions.firstLienAmount > 0)} onClick={() => set({ principal: inputs.acquisitions.firstLienAmount })}>Use first lien ({money(inputs.acquisitions.firstLienAmount)})</Button>
        {bh ? <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => set({ principal: Math.round(bh.salePrice * (1 - bh.downPaymentPct)), annualRate: bh.interestRate, months: Math.round(bh.loanTermYears * 12) })}>Use buy and hold loan ({money(Math.round(bh.salePrice * (1 - bh.downPaymentPct)))})</Button> : null}
      </div>
    </div>
  );
}
