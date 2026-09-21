"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { compsArv, DEFAULT_COMP_RATES, type CompInput, type CompResult, type CompsRates, type CompsSubject } from "@dealcalc/engine";
import { Card, CardHeader, CardBody, Kpi, Stat } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Input, Field, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { addManualComp, saveCompAdjustments, setCompIncluded, useArvInAnalysis } from "@/lib/actions/comps";
import { money, num, shortDate } from "@/lib/utils";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

export type CompRow = { input: CompInput; source: "provider" | "manual"; notes: string };
type AnalysisRef = { id: string; version: number; name: string; status: string; locked: boolean } | null;

const RATE_FIELDS: { key: keyof CompsRates; label: string; step: number; hint: string }[] = [
  { key: "perSqft", label: "Per square foot", step: 5, hint: "Dollars for each square foot of interior difference." },
  { key: "perBed", label: "Per bedroom", step: 500, hint: "Dollars for each bedroom of difference." },
  { key: "perBath", label: "Per bathroom", step: 500, hint: "Dollars for each bathroom of difference." },
  { key: "perYearBuilt", label: "Per year of age", step: 25, hint: "Dollars for each year between the two year built figures." },
  { key: "perLotSqft", label: "Per lot square foot", step: 1, hint: "Applied only when both lot sizes are on file." },
  { key: "monthlyMarket", label: "Market move per month", step: 0.001, hint: "Share of the sale price added for each month since the sale. 0.003 is 0.3 percent a month." },
];

/** A figure that cannot be computed says so rather than showing a number nobody can back up. */
function Missing({ reason }: { reason: string }) {
  return <span className="text-fg-3 font-normal text-[13px]">Not available yet<span className="block text-xs">{reason}</span></span>;
}

export function CompsWorkspaceView({ propertyId, subject, comps, asOf, analysis, canEdit, canWriteAnalysis }: {
  propertyId: string; subject: CompsSubject; comps: CompRow[]; asOf: string; analysis: AnalysisRef; canEdit: boolean; canWriteAnalysis: boolean;
}) {
  const [rates, setRates] = useState<CompsRates>(DEFAULT_COMP_RATES);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const ratesJson = JSON.stringify(rates);

  const result = useMemo(() => compsArv({ subject, comps: comps.map((c) => c.input), asOf, rates }), [subject, comps, asOf, rates]);
  const byId = new Map(result.comps.map((c) => [c.id, c]));
  const noSubjectSqft = subject.sqft === null || subject.sqft <= 0;
  // The analyzer averages its comparables evenly. Show that figure too, so the number that lands there is never a surprise.
  const sendable = result.comps.filter((c) => c.included && c.weight > 0 && c.adjustedPrice > 0).sort((a, b) => b.weight - a.weight).slice(0, 12);
  const evenAverage = sendable.length ? sendable.reduce((a, c) => a + c.adjustedPrice, 0) / sendable.length : null;
  const totalWeight = result.comps.reduce((a, c) => a + c.weight, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="ARV from comps" value={result.arv === null ? <Missing reason="No comp is included." /> : money(result.arv)} sub={`Weighted average of ${result.includedCount} included ${result.includedCount === 1 ? "comp" : "comps"}`} tone="brand" />
        <Kpi label="Range" value={result.low === null || result.high === null ? <Missing reason="No comp is included." /> : `${money(result.low)} to ${money(result.high)}`} sub={result.spread === null ? undefined : `One standard deviation is ${money(result.spread)}, held inside the adjusted prices`} />
        <Kpi label="Price per square foot" value={result.perSqft === null ? <Missing reason={noSubjectSqft ? "The subject square feet are not on file." : "No comp is included."} /> : money(result.perSqft, { cents: true })} sub={subject.sqft ? `ARV divided by ${num(subject.sqft)} sq ft` : undefined} />
        <Kpi label="Confidence" value={result.includedCount === 0 ? <Missing reason="No comp is included." /> : `${Math.round(result.confidence * 100)} of 100`} sub="An estimate aid, not an appraisal" tone={result.confidence >= 0.7 ? "good" : result.confidence >= 0.4 ? "warn" : "bad"} />
      </div>

      <Alert tone="info">This ARV and its confidence score are an estimate aid built from the comps below and the rates you set. They are not an appraisal and not a broker price opinion.</Alert>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Why the score reads the way it does" description="Each sentence covers one part of the score." />
          <CardBody>
            <ul className="space-y-1.5 text-[13px] text-fg-2">{result.reasons.map((r, i) => <li key={i} className="flex gap-2"><span className="text-fg-3">·</span><span>{r}</span></li>)}</ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Write the ARV into the analysis" description="Sends the included comps and their adjusted prices to the analyzer." />
          <CardBody className="space-y-2">
            {analysis === null ? <p className="text-[13px] text-fg-3">No analysis exists for this property yet. Create one from the lead, then come back.</p>
              : analysis.locked ? <p className="text-[13px] text-fg-2">Analysis v{analysis.version} {analysis.name} is {analysis.status.replace(/_/g, " ")} and locked, so nothing can be written into it. Clone it in the analyzer first. <Link href={`/analyzer/${analysis.id}`} className="text-brand hover:underline">Open the analysis</Link></p>
              : !canWriteAnalysis ? <p className="text-[13px] text-fg-3">Your role can read analyses but not change them.</p>
              : sendable.length === 0 || evenAverage === null ? <p className="text-[13px] text-fg-3">Include at least one comp with an adjusted price above zero first.</p>
              : (
                <>
                  <p className="text-[13px] text-fg-2">Writes the top {sendable.length} included {sendable.length === 1 ? "comp" : "comps"} by weight into v{analysis.version} {analysis.name} and turns on the comparable average as the ARV. The ARV typed on the Deal section is set aside while that is on.</p>
                  <p className="text-[13px] text-fg-2">The analyzer averages its comparables evenly, so the ARV it will show is {money(evenAverage)} rather than the weighted {result.arv === null ? "figure above" : money(result.arv)}.</p>
                  <ActionButton action={useArvInAnalysis.bind(null, propertyId, analysis.id, ratesJson)} variant="primary" size="md" confirm={`Write ${sendable.length} comparables into v${analysis.version} and use their average as the ARV?`}>Use this ARV in the analysis</ActionButton>
                  <Link href={`/analyzer/${analysis.id}`} className="block text-xs text-brand hover:underline">Open v{analysis.version} in the analyzer</Link>
                </>
              )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Adjustment rates" description="Starting values, not market facts. Set them from what local sales show before you rely on the output." />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {RATE_FIELDS.map((f) => (
              <Field key={String(f.key)} label={f.label} hint={f.hint}>
                <Input type="number" step={f.step} min={f.key === "monthlyMarket" ? -0.1 : 0} value={rates[f.key]} onChange={(e) => setRates((r) => ({ ...r, [f.key]: Number(e.target.value) || 0 }))} />
              </Field>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setRates(DEFAULT_COMP_RATES)}>Back to the defaults</Button>
            <span className="text-xs text-fg-3">Rates live on this page only. They travel with each save so the stored adjusted price matches what you see.</span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Comps (${comps.length})`} description="A comp is adjusted toward the subject. The subject being larger, newer, or roomier raises the comp." actions={canEdit ? <Button type="button" variant="outline" size="sm" onClick={() => setAdding((v) => !v)}><Plus className="h-3.5 w-3.5" />{adding ? "Close" : "Add a comp"}</Button> : null} />
        {adding && canEdit ? (
          <CardBody className="border-b border-border bg-surface-2">
            <ActionForm action={addManualComp.bind(null, propertyId)} submitLabel="Add the comp" resetOnSuccess onSuccess={() => { setAdding(false); router.refresh(); }}>
              <input type="hidden" name="rates" value={ratesJson} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Address" className="sm:col-span-2"><Input name="address" maxLength={200} required placeholder="14 Oak Street" /></Field>
                <Field label="Sold price"><Input name="soldPrice" type="number" step={1000} min={0} required placeholder="210000" /></Field>
                <Field label="Sold on"><Input name="soldAt" type="date" /></Field>
                <Field label="Square feet"><Input name="sqft" type="number" step={10} min={0} /></Field>
                <Field label="Beds"><Input name="beds" type="number" step={1} min={0} /></Field>
                <Field label="Baths"><Input name="baths" type="number" step={0.5} min={0} /></Field>
                <Field label="Year built"><Input name="yearBuilt" type="number" step={1} min={1600} max={2100} /></Field>
                <Field label="Distance in miles"><Input name="distanceMi" type="number" step={0.1} min={0} /></Field>
                <Field label="Note" className="sm:col-span-2 lg:col-span-3"><Input name="notes" maxLength={500} placeholder="Where it came from, or what makes it close" /></Field>
              </div>
            </ActionForm>
          </CardBody>
        ) : null}
        <CardBody className="p-0">
          {comps.length === 0 ? <p className="p-4 text-[13px] text-fg-3">No comps yet. Provider comps arrive with a property report pull, and you can add your own above.</p> : (
            <Table>
              <THead><tr><TH>Address</TH><TH right>Sold</TH><TH>Date</TH><TH right>Sq ft</TH><TH right>Dist. mi</TH><TH right>Net adj.</TH><TH right>Adjusted</TH><TH right>$/sq ft</TH><TH right>Weight</TH><TH>In</TH></tr></THead>
              <TBody>
                {comps.map((c) => {
                  const r = byId.get(c.input.id);
                  if (!r) return null;
                  const expanded = open === c.input.id;
                  return (
                    <CompRowView key={c.input.id} row={c} result={r} expanded={expanded} onToggle={() => setOpen(expanded ? null : c.input.id)} canEdit={canEdit} ratesJson={ratesJson} totalWeight={totalWeight} />
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function CompRowView({ row, result, expanded, onToggle, canEdit, ratesJson, totalWeight }: {
  row: CompRow; result: CompResult; expanded: boolean; onToggle: () => void; canEdit: boolean; ratesJson: string; totalWeight: number;
}) {
  return (
    <>
      <TR className={result.included ? "" : "opacity-50"}>
        <TD>
          <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex items-start gap-1.5 text-left hover:text-brand">
            {expanded ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
            <span>
              {result.label}
              <span className="block text-xs text-fg-3">{row.source === "manual" ? "Added by hand" : "From the provider"}{result.flags.length ? ` · ${result.flags.length} ${result.flags.length === 1 ? "note" : "notes"}` : ""}</span>
            </span>
          </button>
        </TD>
        <TD right className="font-medium">{result.price > 0 ? money(result.price) : <span className="text-fg-3">Not available yet</span>}</TD>
        <TD>{row.input.soldOn ? shortDate(row.input.soldOn) : <span className="text-fg-3">No date</span>}</TD>
        <TD right>{row.input.sqft ? num(row.input.sqft) : ""}</TD>
        <TD right>{row.input.distanceMi ?? ""}</TD>
        <TD right className={result.netAdjustment < 0 ? "text-bad" : result.netAdjustment > 0 ? "text-good" : undefined}>{money(result.netAdjustment)}</TD>
        <TD right className="font-medium">{money(result.adjustedPrice)}</TD>
        <TD right>{result.adjustedPerSqft === null ? "" : money(result.adjustedPerSqft, { cents: true })}</TD>
        <TD right>{result.included ? (totalWeight > 0 ? `${Math.round((result.weight / totalWeight) * 100)}%` : "0%") : ""}</TD>
        <TD>{canEdit ? <ActionButton action={setCompIncluded.bind(null, result.id, !result.included)} variant={result.included ? "outline" : "ghost"} size="sm">{result.included ? "Included" : "Excluded"}</ActionButton> : <Badge tone={result.included ? "good" : "neutral"}>{result.included ? "In" : "Out"}</Badge>}</TD>
      </TR>
      {expanded ? (
        <TR>
          <TD className="p-0" colSpan={10}>
            <div className="bg-surface-2 border-t border-border px-4 py-3 grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="text-xs font-semibold text-fg-2 mb-2">The math on this comp</h4>
                <Stat label="Sold price" value={money(result.price)} />
                {result.adjustments.map((a, i) => <Stat key={i} label={a.label} value={money(a.amount)} hint={a.basis} tone={a.amount < 0 ? "bad" : a.amount > 0 ? "good" : "muted"} />)}
                <Stat label="Net adjustment" value={money(result.netAdjustment)} />
                <Stat label="Adjusted price" value={money(result.adjustedPrice)} />
                <ul className="mt-2 space-y-1 text-xs text-fg-3">{result.adjustments.map((a, i) => <li key={i}>{a.label}: {a.basis}</li>)}</ul>
                <div className="mt-3 text-xs text-fg-3">
                  Weight {result.weight} = distance {result.weightParts.distance} times recency {result.weightParts.recency} times size {result.weightParts.size}.
                  {result.monthsSinceSale === null ? " Months since sale are not known." : ` Sold ${result.monthsSinceSale} months ago.`}
                </div>
                {result.flags.length ? <ul className="mt-2 space-y-1 text-xs text-warn">{result.flags.map((f, i) => <li key={i}>{f}</li>)}</ul> : null}
              </div>
              <div>
                <h4 className="text-xs font-semibold text-fg-2 mb-2">Adjustments you add by hand</h4>
                {canEdit ? <ManualAdjustmentForm key={JSON.stringify(row.input.manual)} compId={result.id} initial={row.input.manual} notes={row.notes} ratesJson={ratesJson} /> : <p className="text-[13px] text-fg-3">Your role can read comps but not change them.</p>}
              </div>
            </div>
          </TD>
        </TR>
      ) : null}
    </>
  );
}

function ManualAdjustmentForm({ compId, initial, notes, ratesJson }: { compId: string; initial: { label: string; amount: number }[]; notes: string; ratesJson: string }) {
  const [lines, setLines] = useState(initial.length ? initial : [{ label: "", amount: 0 }]);
  const router = useRouter();
  return (
    <ActionForm action={saveCompAdjustments.bind(null, compId)} submitLabel="Save the adjustments" onSuccess={() => router.refresh()}>
      <input type="hidden" name="rates" value={ratesJson} />
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_130px_auto] gap-2 items-center">
            <Input name="adjustmentLabel" maxLength={80} value={l.label} placeholder="New roof, corner lot, seller credit" aria-label={`Adjustment ${i + 1} label`} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
            <Input name="adjustmentAmount" type="number" step={500} value={l.amount || ""} placeholder="Dollars" aria-label={`Adjustment ${i + 1} amount`} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, amount: Number(e.target.value) || 0 } : y)))} />
            <button type="button" aria-label={`Remove adjustment ${i + 1}`} onClick={() => setLines((x) => (x.length === 1 ? [{ label: "", amount: 0 }] : x.filter((_, j) => j !== i)))} className="p-1.5 rounded text-fg-3 hover:text-bad hover:bg-black/5"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={lines.length >= 10} onClick={() => setLines((x) => [...x, { label: "", amount: 0 }])}><Plus className="h-3.5 w-3.5" />Add an adjustment</Button>
        <Field label="Note on this comp"><Textarea name="notes" rows={2} maxLength={500} defaultValue={notes} placeholder="What makes this comp close, or what to watch" /></Field>
        <p className="text-xs text-fg-3">A negative amount lowers the comp toward the subject. A blank label or a zero amount is dropped.</p>
      </div>
    </ActionForm>
  );
}
