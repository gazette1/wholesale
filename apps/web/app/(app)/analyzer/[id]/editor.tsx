"use client";
import { useMemo, useState, useTransition, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { DealInput } from "@dealcalc/engine";
import { runDeal, type DealOutputs } from "@/lib/deal-run";
import { saveAnalysis } from "@/lib/actions/analyzer";
import type { ActionResult } from "@/lib/actions/leads";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { Outputs } from "./outputs";
import { LockedContext, NumField, SectionTitle } from "./fields";
import { OffersSection, RehabSection, LoanSection, defaultOffers, type Patch } from "./sections";
import { FieldGuide } from "./field-guide";
import { cn, money } from "@/lib/utils";

type PropertyLite = { id: string; sqft: number | null; condition: string; occupancy: string; propertyType: string | null; state: string; county: string | null; postalCode: string };
type ReportLite = { avm: number | null; arv: number | null; rent: number | null; payoff: number; taxAmount: number | null } | null;
export type Sibling = { id: string; version: number; name: string; status: string; outputs: DealOutputs | Record<string, never>; inputs: DealInput };

/**
 * Versions saved before engine 0.3.0 carry the workbook's two rate cells per lien. Show them as one annual rate.
 * First lien: both cells are charged per hold month, so their sum times 12 is exactly equivalent.
 * Second lien: the sheet charged its first cell once (A-21), so that part is spread over the hold to keep today's total.
 */
function withAnnualRates(a: DealInput["acquisitions"]): DealInput["acquisitions"] {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    ...a,
    firstAnnualRate: a.firstAnnualRate ?? round((a.firstInterestRate + a.firstMonthlyInterestOnlyRate) * 12),
    secondAnnualRate: a.secondAnnualRate ?? round(a.secondMonthlyInterestOnlyRate * 12 + (a.holdMonths > 0 ? (a.secondInterestRate * 12) / a.holdMonths : 0)),
  };
}

const SECTIONS = [["deal", "Deal"], ["offers", "Offers"], ["rehab", "Rehab"], ["financing", "Financing"], ["holding", "Holding"], ["costs", "Closing costs"], ["rental", "Buy and hold"], ["loan", "Loan"]] as const;
type SectionKey = (typeof SECTIONS)[number][0];

export function Editor({ analysisId, initialInputs, name: initialName, notes: initialNotes, locked, lockedReason, property, report, comps, siblings, initialTab, canDelete, deleteAction }: {
  analysisId: string; initialInputs: DealInput; name: string; notes: string; locked: boolean; lockedReason?: string; property: PropertyLite; report: ReportLite;
  comps: { address: string; soldPrice: number | null; sqft: number | null; distanceMi: number | null }[]; siblings: Sibling[]; initialTab?: string; canDelete: boolean; deleteAction: () => Promise<ActionResult | never>;
}) {
  // Versions saved before the Offers and Rehab source blocks existed get property based defaults, without marking the form dirty.
  const [inputs, setInputs] = useState<DealInput>(() => ({
    ...initialInputs,
    acquisitions: withAnnualRates(initialInputs.acquisitions),
    offers: initialInputs.offers ?? defaultOffers(property.sqft ?? 0),
    rehabPlan: initialInputs.rehabPlan ?? { source: initialInputs.acquisitions.repairCostsOverride != null ? "manual" : "checklist", perSqftRate: 30, squareFeet: property.sqft ?? 0 },
  }));
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [section, setSection] = useState<SectionKey>("deal");
  const router = useRouter();
  const sqft = inputs.offers?.squareFeet ?? property.sqft ?? 0;

  const outputs = useMemo(() => { try { return { ok: true as const, value: runDeal(inputs, { sensitivity: true }) }; } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; } }, [inputs]);

  const patch: Patch = useCallback((fn) => { setDirty(true); setInputs((prev) => fn(prev)); }, []);
  const acq = inputs.acquisitions;
  const ws = inputs.wholesale ?? { arv: acq.arv, repairCosts: 0, assignmentFee: Math.abs(acq.assignmentFee), purchasePrice: acq.purchasePrice, investorBuyPrice: null, closingCosts: 0, holdingCosts: 0, existingMortgagePayoff: 0, sellerClosingCosts: 0 };
  const bh = inputs.buyAndHold;
  type Acq = DealInput["acquisitions"];
  const setAcq = useCallback(<K extends keyof Acq>(key: K, value: Acq[K]) => patch((prev) => ({ ...prev, acquisitions: { ...prev.acquisitions, [key]: value } })), [patch]);
  const setWs = useCallback((key: string, value: number | null) => patch((prev) => {
    const a = prev.acquisitions;
    const base = prev.wholesale ?? { arv: a.arv, repairCosts: 0, assignmentFee: Math.abs(a.assignmentFee), purchasePrice: a.purchasePrice, investorBuyPrice: null, closingCosts: 0, holdingCosts: 0, existingMortgagePayoff: 0, sellerClosingCosts: 0 };
    return { ...prev, wholesale: { ...base, [key]: value } as DealInput["wholesale"] };
  }), [patch]);
  const setBh = useCallback((key: string, value: unknown) => patch((prev) => (prev.buyAndHold ? { ...prev, buyAndHold: { ...prev.buyAndHold, [key]: value } } : prev)), [patch]);

  // Warn before leaving with unsaved edits. beforeunload covers reload and close. In app links (version pills, sidebar,
  // breadcrumbs, Match buyers, Deal package) never fire it, so a capture phase click handler asks first. The header's
  // status and clone buttons read the same flag from the document and refuse while it is set.
  useEffect(() => {
    document.documentElement.dataset.unsavedAnalysis = dirty ? "1" : "";
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm("You have unsaved changes in this analysis. Leave without saving?")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onUnload); document.removeEventListener("click", onClick, true); document.documentElement.dataset.unsavedAnalysis = ""; };
  }, [dirty]);

  function save() {
    start(async () => {
      const res = await saveAnalysis(analysisId, { inputs: { ...inputs, meta: { ...inputs.meta, name } }, name, notes });
      setFlash(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error });
      // A success note fades. An error stays until the next save so there is time to read it.
      if (res.ok) { setDirty(false); router.refresh(); setTimeout(() => setFlash((f) => (f?.ok ? null : f)), 3000); }
    });
  }

  const issues = outputs.ok ? outputs.value.issues : [];
  const countFor = (key: SectionKey) => issues.filter((i) => i.section === key).length;
  const usingAverage = outputs.ok && outputs.value.offers.arvSource === "comparables";

  return (
    <LockedContext.Provider value={locked}>
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-2 space-y-3 min-w-0">
          <Card>
            <CardHeader
              title={<input value={name} disabled={locked} aria-label="Version name" maxLength={80} onChange={(e) => { setName(e.target.value); setDirty(true); }} className="bg-transparent font-semibold text-[13px] focus:outline-none border-b border-transparent focus:border-border w-full" />}
              description={locked ? lockedReason ?? "Locked. Clone to edit." : dirty ? "Unsaved changes" : "All changes recalculate instantly"}
              actions={<><FieldGuide />{!locked ? <Button variant="primary" size="sm" loading={pending} onClick={save} disabled={!dirty && !pending}>Save</Button> : null}</>}
            />
            <div role="tablist" aria-label="Input sections" className="flex gap-1 px-2 py-1.5 border-b border-border overflow-x-auto scrollbar-thin">
              {SECTIONS.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={section === key} onClick={() => setSection(key)} className={cn("px-2.5 py-1.5 text-[13px] rounded-md whitespace-nowrap", section === key ? "bg-black/[0.06] font-medium" : "text-fg-3 hover:text-fg")}>
                  {label}{countFor(key) ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-warn align-middle" aria-label={`${countFor(key)} notes`} /> : null}
                </button>
              ))}
            </div>
            <CardBody className="space-y-3 max-h-[70vh] overflow-y-auto scrollbar-thin">
              {flash ? <Alert tone={flash.ok ? "good" : "bad"}>{flash.text}</Alert> : null}
              {issues.filter((i) => i.section === section).map((i, k) => <Alert key={k} tone={i.level === "error" ? "bad" : "warn"}>{i.message}</Alert>)}

              {section === "deal" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Strategy" hint="Which exit this scenario is written for. Shown in the analyzer list.">
                      <Select value={inputs.meta.strategy ?? "wholesale"} disabled={locked} onChange={(e) => patch((p) => ({ ...p, meta: { ...p.meta, strategy: e.target.value as "wholesale" | "flip" | "rental" } }))}>
                        <option value="wholesale">Wholesale</option><option value="flip">Flip</option><option value="rental">Rental</option>
                      </Select>
                    </Field>
                    <NumField label="Hold months" plain value={acq.holdMonths} onChange={(v) => setAcq("holdMonths", v)} step={1} min={0} max={120} hint="Flip timeline. The weekly cash flow grid covers up to 9 months." />
                    <NumField label="After repair value" value={acq.arv} onChange={(v) => { setAcq("arv", v); setWs("arv", v); }} step={1000} hint="Value after repairs, from comps" disabled={usingAverage} />
                    <NumField label="Proposed offer" value={acq.purchasePrice} onChange={(v) => patch((p) => ({ ...p, acquisitions: { ...p.acquisitions, purchasePrice: v, firstLienAmount: p.acquisitions.firstLienAmount === p.acquisitions.purchasePrice ? v : p.acquisitions.firstLienAmount }, wholesale: p.wholesale ? { ...p.wholesale, purchasePrice: v } : p.wholesale }))} step={1000} />
                    <NumField label="As is value" value={acq.asIsValue} onChange={(v) => setAcq("asIsValue", v)} step={1000} hint="Tax base for holding costs" />
                    <NumField label="Offer percent of ARV" value={acq.arvFactor ?? 0.7} onChange={(v) => setAcq("arvFactor", v)} pct hint="70% rule by default" />
                    <NumField label="Assignment fee or target margin" value={ws.assignmentFee} onChange={(v) => patch((p) => ({ ...p, acquisitions: { ...p.acquisitions, assignmentFee: -Math.abs(v) }, wholesale: { ...(p.wholesale ?? ws), assignmentFee: Math.abs(v) } }))} step={500} min={0} />
                    <NumField label="Investor buy price" value={ws.investorBuyPrice ?? null} onClear={() => setWs("investorBuyPrice", null)} onChange={(v) => setWs("investorBuyPrice", v || null)} step={1000} placeholder="auto" hint="Leave blank to use ARV times the offer percent, minus repairs" />
                    <NumField label="Existing mortgage payoff" value={ws.existingMortgagePayoff ?? 0} onChange={(v) => setWs("existingMortgagePayoff", v)} step={1000} hint="Seller must net at least this" />
                    <NumField label="Wholesale closing costs" value={ws.closingCosts ?? 0} onChange={(v) => setWs("closingCosts", v)} step={100} />
                    <NumField label="Seller closing costs" value={ws.sellerClosingCosts ?? 0} onChange={(v) => setWs("sellerClosingCosts", v)} step={100} />
                  </div>
                  {usingAverage ? <p className="text-xs text-fg-3">ARV is coming from the comparable average ({money(outputs.value.effectiveArv)}). Turn that off on the Offers section to type a value here.</p> : null}
                  {report ? (
                    <div className="rounded-md border border-border bg-surface-2 p-2.5 text-xs text-fg-2 space-y-1">
                      <div className="font-medium text-fg">From the property report (click to apply)</div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {report.avm != null ? <button type="button" disabled={locked} className="underline decoration-dotted hover:text-brand disabled:no-underline" onClick={() => setAcq("asIsValue", report.avm!)}>AVM {money(report.avm)}</button> : null}
                        {report.arv != null ? <button type="button" disabled={locked || usingAverage} className="underline decoration-dotted hover:text-brand disabled:no-underline" onClick={() => { setAcq("arv", report.arv!); setWs("arv", report.arv!); }}>ARV {money(report.arv)}</button> : null}
                        {report.payoff ? <button type="button" disabled={locked} className="underline decoration-dotted hover:text-brand disabled:no-underline" onClick={() => setWs("existingMortgagePayoff", report.payoff)}>Payoff {money(report.payoff)}</button> : null}
                        {report.rent != null ? <span>Rent est. {money(report.rent)}</span> : null}
                      </div>
                      {comps.length ? <div className="text-fg-3">Comps: {comps.slice(0, 3).map((c) => `${money(c.soldPrice)}${c.sqft ? ` (${money((c.soldPrice ?? 0) / c.sqft)}/sf)` : ""}`).join(", ")}</div> : null}
                    </div>
                  ) : null}
                  <Field label="Notes and supporting comps"><Textarea value={notes} disabled={locked} maxLength={4000} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="Why this ARV, which comps, what the buyer said" /></Field>
                </>
              ) : null}

              {section === "offers" ? <OffersSection inputs={inputs} patch={patch} outputs={outputs.ok ? outputs.value : null} sqft={property.sqft ?? 0} reportComps={comps} /> : null}
              {section === "rehab" ? <RehabSection inputs={inputs} patch={patch} outputs={outputs.ok ? outputs.value : null} sqft={sqft} /> : null}

              {section === "financing" ? (
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="First lien amount" value={acq.firstLienAmount} onChange={(v) => setAcq("firstLienAmount", v)} step={1000} min={0} />
                  <NumField label="First lien points" value={acq.firstPointsRate} onChange={(v) => setAcq("firstPointsRate", v)} pct />
                  <NumField label="First lien interest rate (annual)" value={acq.firstAnnualRate ?? 0} onChange={(v) => setAcq("firstAnnualRate", v)} pct min={0} max={50} hint="A yearly rate, such as 14. Interest for the hold is the lien times this rate, divided by 12, times the hold months." />
                  <NumField label="Second lien amount" value={acq.secondLienAmount} onChange={(v) => setAcq("secondLienAmount", v)} step={1000} min={0} />
                  <NumField label="Second lien points" value={acq.secondPointsRate} onChange={(v) => setAcq("secondPointsRate", v)} pct />
                  <NumField label="Second lien interest rate (annual)" value={acq.secondAnnualRate ?? 0} onChange={(v) => setAcq("secondAnnualRate", v)} pct min={0} max={50} hint="A yearly rate. Accrues per hold month, the same way as the first lien." />
                  <NumField label="Misc lien paid" value={acq.miscLienAmountPaid} onChange={(v) => setAcq("miscLienAmountPaid", v)} step={100} />
                  <NumField label="Misc points paid" value={acq.miscPointsPaid} onChange={(v) => setAcq("miscPointsPaid", v)} step={100} />
                  <NumField label="Misc interest paid" value={acq.miscInterestPaid} onChange={(v) => setAcq("miscInterestPaid", v)} step={100} />
                  <NumField label="Misc financing costs" value={acq.miscFinancingCosts} onChange={(v) => setAcq("miscFinancingCosts", v)} step={100} />
                </div>
              ) : null}

              {section === "holding" ? (
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Property tax rate (annual, on as is value)" value={acq.propertyTaxRate} onChange={(v) => setAcq("propertyTaxRate", v)} pct />
                  <NumField label="HOA per month" value={acq.hoaMonthly} onChange={(v) => setAcq("hoaMonthly", v)} step={25} />
                  <NumField label="Insurance per month" value={acq.insuranceMonthly} onChange={(v) => setAcq("insuranceMonthly", v)} step={25} />
                  <NumField label="Utilities per month (combined)" value={acq.utilitiesMonthly} onChange={(v) => setAcq("utilitiesMonthly", v)} step={25} />
                  <NumField label="Gas per month" value={acq.gasMonthly} onChange={(v) => setAcq("gasMonthly", v)} step={10} />
                  <NumField label="Water per month" value={acq.waterMonthly} onChange={(v) => setAcq("waterMonthly", v)} step={10} />
                  <NumField label="Electricity per month" value={acq.electricityMonthly} onChange={(v) => setAcq("electricityMonthly", v)} step={10} />
                  <NumField label="Misc utilities per month" value={acq.miscUtilitiesMonthly} onChange={(v) => setAcq("miscUtilitiesMonthly", v)} step={10} />
                  {acq.miscHoldingMonthly.map((m, i) => <NumField key={i} label={`Misc holding ${i + 1} per month`} value={m} onChange={(v) => setAcq("miscHoldingMonthly", acq.miscHoldingMonthly.map((x, j) => (j === i ? v : x)) as Acq["miscHoldingMonthly"])} step={25} />)}
                </div>
              ) : null}

              {section === "costs" ? (
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Buy: escrow or attorney" value={acq.buyEscrowRate} onChange={(v) => setAcq("buyEscrowRate", v)} pct />
                  <NumField label="Buy: title" value={acq.buyTitleRate} onChange={(v) => setAcq("buyTitleRate", v)} pct />
                  <NumField label="Buy: misc" value={acq.buyMiscRate} onChange={(v) => setAcq("buyMiscRate", v)} pct />
                  <NumField label="Sell: escrow or attorney" value={acq.sellEscrowRate} onChange={(v) => setAcq("sellEscrowRate", v)} pct />
                  <NumField label="Sell: recording" value={acq.sellRecordingRate} onChange={(v) => setAcq("sellRecordingRate", v)} pct />
                  <NumField label="Sell: realtor" value={acq.sellRealtorRate} onChange={(v) => setAcq("sellRealtorRate", v)} pct />
                  <NumField label="Sell: transfer" value={acq.sellTransferRate} onChange={(v) => setAcq("sellTransferRate", v)} pct />
                  <NumField label="Home warranty" value={acq.sellHomeWarranty} onChange={(v) => setAcq("sellHomeWarranty", v)} step={100} />
                  <NumField label="Staging" value={acq.sellStaging} onChange={(v) => setAcq("sellStaging", v)} step={100} />
                  <NumField label="Marketing" value={acq.sellMarketing} onChange={(v) => setAcq("sellMarketing", v)} step={100} />
                  <NumField label="Misc selling" value={acq.sellMisc} onChange={(v) => setAcq("sellMisc", v)} step={100} />
                  <p className="col-span-2 text-xs text-fg-3">Percent bases follow the workbook (buying costs on ARV, recording and realtor on the offer) until the anomaly flags are switched. See docs.</p>
                </div>
              ) : null}

              {section === "rental" ? (bh ? (
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Purchase price" value={bh.salePrice} onChange={(v) => setBh("salePrice", v)} step={1000} />
                  <NumField label="Down payment" value={bh.downPaymentPct} onChange={(v) => setBh("downPaymentPct", v)} pct />
                  <NumField label="Interest rate" value={bh.interestRate} onChange={(v) => setBh("interestRate", v)} pct />
                  <NumField label="Term years" plain value={bh.loanTermYears} onChange={(v) => setBh("loanTermYears", v)} step={1} min={1} max={50} />
                  <NumField label="Closing costs" value={bh.closingCosts} onChange={(v) => setBh("closingCosts", v)} step={500} />
                  <NumField label="Property tax per year" value={bh.propertyTaxYear} onChange={(v) => setBh("propertyTaxYear", v)} step={100} />
                  <NumField label="Insurance per month" value={bh.insuranceMonth} onChange={(v) => setBh("insuranceMonth", v)} step={10} />
                  <NumField label="Gas and electric per month" value={bh.gasElectricMonth} onChange={(v) => setBh("gasElectricMonth", v)} step={10} />
                  <NumField label="Water per month" value={bh.waterMonth} onChange={(v) => setBh("waterMonth", v)} step={10} />
                  <NumField label="Sewer per month" value={bh.sewerMonth} onChange={(v) => setBh("sewerMonth", v)} step={10} />
                  <NumField label="Garbage per month" value={bh.garbageMonth} onChange={(v) => setBh("garbageMonth", v)} step={10} />
                  <NumField label="Lawn and snow per month" value={bh.lawnSnowMonth} onChange={(v) => setBh("lawnSnowMonth", v)} step={10} />
                  <NumField label="Management" value={bh.managementPct} onChange={(v) => setBh("managementPct", v)} pct />
                  <NumField label="Vacancy" value={bh.vacancyPct} onChange={(v) => setBh("vacancyPct", v)} pct />
                  <NumField label="Maintenance" value={bh.maintenancePct} onChange={(v) => setBh("maintenancePct", v)} pct />
                  <NumField label="Cash reserves" value={bh.cashReservesPct} onChange={(v) => setBh("cashReservesPct", v)} pct />
                  <NumField label="Required DCR" plain value={bh.dcrRequired} onChange={(v) => setBh("dcrRequired", v > 0 ? v : 1)} step={0.05} min={0.5} hint="Debt coverage ratio the lender requires, often 1.20 to 1.25" />
                  <NumField label="Marginal tax rate" value={bh.marginalTaxRate} onChange={(v) => setBh("marginalTaxRate", v)} pct />
                  <NumField label="Appreciation per year" value={bh.appreciationRate} onChange={(v) => setBh("appreciationRate", v)} pct />
                  <NumField label="Rent growth per year" value={bh.rentGrowthRate} onChange={(v) => setBh("rentGrowthRate", v)} pct />
                  <div className="col-span-2 space-y-1.5">
                    <SectionTitle note="One row per unit. Current rent is what tenants pay today. Market rent is what the unit should bring.">Rent roll</SectionTitle>
                    <div className="grid grid-cols-[28px_52px_52px_1fr_1fr_auto] gap-2 text-[11px] uppercase tracking-wide text-fg-3"><span>#</span><span>Beds</span><span>Baths</span><span>Current rent</span><span>Market rent</span><span /></div>
                    {bh.units.map((u, i) => {
                      const setUnit = (p: Partial<typeof u>) => setBh("units", bh.units.map((x, j) => (j === i ? { ...x, ...p } : x)));
                      const n = (v: string) => (v === "" ? null : Number(v));
                      return (
                        <div key={i} className="grid grid-cols-[28px_52px_52px_1fr_1fr_auto] gap-2 items-center">
                          <span className="text-xs text-fg-3">{i + 1}</span>
                          <Input type="number" min={0} step={1} value={u.beds ?? ""} disabled={locked} aria-label={`Unit ${i + 1} beds`} onChange={(e) => setUnit({ beds: n(e.target.value) })} />
                          <Input type="number" min={0} step={0.5} value={u.baths ?? ""} disabled={locked} aria-label={`Unit ${i + 1} baths`} onChange={(e) => setUnit({ baths: n(e.target.value) })} />
                          <Input type="number" min={0} step={25} value={u.rent ?? ""} disabled={locked} aria-label={`Unit ${i + 1} current rent`} onChange={(e) => setUnit({ rent: n(e.target.value) ?? 0 })} placeholder="Rent" />
                          <Input type="number" min={0} step={25} value={u.marketRent ?? ""} disabled={locked} aria-label={`Unit ${i + 1} market rent`} onChange={(e) => setUnit({ marketRent: n(e.target.value) ?? 0 })} placeholder="Market" />
                          <button type="button" disabled={locked || bh.units.length === 1} onClick={() => setBh("units", bh.units.filter((_, j) => j !== i))} className="text-xs text-fg-3 hover:text-bad disabled:opacity-40">Remove</button>
                        </div>
                      );
                    })}
                    {bh.units.length < 20 ? <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => setBh("units", [...bh.units, { unit: bh.units.length + 1, beds: null, baths: null, rent: 0, marketRent: 0 }])}>Add unit</Button> : null}
                  </div>
                </div>
              ) : <p className="text-[13px] text-fg-3">This version was saved without a rental block. Clone a newer analysis to model the rental exit.</p>) : null}

              {section === "loan" ? <LoanSection inputs={inputs} patch={patch} /> : null}
            </CardBody>
          </Card>
          {canDelete ? <form action={deleteAction as unknown as (form: FormData) => void} onSubmit={(e) => { if (!window.confirm("Delete this analysis version for good? A version with a deal package or a record of buyers it was sent to cannot be deleted here; move it to trash from the analyzer list instead.")) e.preventDefault(); }}><Button type="submit" variant="ghost" size="sm" className="text-bad">Delete version</Button></form> : null}
        </div>

        <div className="xl:col-span-3 min-w-0">
          {outputs.ok ? <Outputs outputs={outputs.value} inputs={inputs} siblings={siblings} currentId={analysisId} initialTab={initialTab} onOpenSection={(s) => setSection(s as SectionKey)} /> : <Alert tone="bad">{outputs.error}</Alert>}
        </div>
      </div>
    </LockedContext.Provider>
  );
}
