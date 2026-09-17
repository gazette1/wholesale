"use client";
import { useState } from "react";
import type { DealInput } from "@dealcalc/engine";
import type { DealOutputs } from "@/lib/deal-run";
import type { Sibling } from "./editor";
import { Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { cn, money, percent, multiple } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";

const TABS = ["offer", "flip", "cashflow", "rehab", "rental", "sensitivity", "compare"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = { offer: "Offer", flip: "Flip P&L", cashflow: "Cash flow", rehab: "Rehab", rental: "Buy and hold", sensitivity: "Sensitivity", compare: "Compare" };

export function Outputs({ outputs, inputs, siblings, currentId, initialTab }: { outputs: DealOutputs; inputs: DealInput; siblings: Sibling[]; currentId: string; initialTab?: string }) {
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(initialTab ?? "") ? (initialTab as Tab) : "offer");
  const [schedule, setSchedule] = useState<"delayed" | "upfront">("delayed");
  const a = outputs.acquisitions;
  const w = outputs.wholesale;
  const flow = schedule === "delayed" ? a.delayed : a.upfront;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Max allowable offer" value={money(w.maxAllowableOffer)} sub={`${percent(w.arvFactor)} of ARV less repairs and fee`} />
        <Kpi label="Spread to investor" value={money(w.spread)} tone={w.spread > 0 ? "good" : "bad"} sub={`Investor pays ${money(w.investorBuyPrice)}`} />
        <Kpi label="Flip net profit" value={money(a.netProfit)} tone={a.netProfit > 0 ? "good" : "bad"} sub={`ROI on cash ${multiple(a.roiOnCash)}`} />
        <Kpi label="Offer as % of ARV" value={percent(w.arvPct)} tone={w.arvPct <= 0.7 ? "good" : w.arvPct <= 0.8 ? undefined : "bad"} sub={`Repairs ${money(a.repairCosts)} (${a.repairCostsSource})`} />
      </div>
      <div className="flex gap-1 border-b border-border overflow-x-auto scrollbar-thin">
        {TABS.filter((t) => t !== "compare" || siblings.length > 1).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("relative px-3 py-2 text-[13px] whitespace-nowrap", tab === t ? "font-medium text-fg" : "text-fg-3 hover:text-fg")}>{LABELS[t]}{tab === t ? <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-fg rounded-full" /> : null}</button>
        ))}
      </div>

      {tab === "offer" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Card><CardHeader title="Offer math" /><CardBody>
            <Stat label="ARV" value={money(inputs.acquisitions.arv)} />
            <Stat label={`${percent(w.arvFactor)} of ARV`} value={money(inputs.acquisitions.arv * w.arvFactor)} />
            <Stat label="Less repairs" value={`(${money(a.repairCosts)})`} />
            <Stat label="Less assignment fee or margin" value={`(${money(w.costBreakdown.assignmentFee)})`} />
            <Stat label="Max allowable offer" value={money(w.maxAllowableOffer)} />
            <Stat label="Proposed offer" value={money(inputs.acquisitions.purchasePrice)} tone={w.offerAboveMao > 0 ? "bad" : "good"} hint={w.offerAboveMao > 0 ? `${money(w.offerAboveMao)} above MAO` : `${money(-w.offerAboveMao)} under MAO`} />
          </CardBody></Card>
          <Card><CardHeader title="Investor exit" /><CardBody>
            <Stat label="Investor buy price" value={money(w.investorBuyPrice)} />
            <Stat label="Investor all in as % of ARV" value={percent(w.investorArvPct)} />
            <Stat label="Gross spread" value={money(w.grossProfit)} tone={w.grossProfit > 0 ? "good" : "bad"} />
            <Stat label="Wholesale closing and holding" value={`(${money(w.costBreakdown.closingCosts + w.costBreakdown.holdingCosts)})`} />
            <Stat label="Net assignment profit" value={money(w.netProfit)} tone={w.netProfit > 0 ? "good" : "bad"} />
            <Stat label="Margin on investor price" value={percent(w.marginPct)} />
            <Stat label="Seller net after payoff" value={money(w.sellerNet)} tone={w.sellerNet < 0 ? "bad" : undefined} hint="Offer less mortgage payoff and seller closing costs" />
          </CardBody></Card>
        </div>
      ) : null}

      {tab === "flip" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Card><CardHeader title="Profit and loss" description="Workbook Acquisitions Deal Analyzer" /><CardBody>
            <Stat label="Sale (ARV)" value={money(inputs.acquisitions.arv)} />
            <Stat label="Purchase" value={`(${money(inputs.acquisitions.purchasePrice)})`} />
            <Stat label="Repairs" value={`(${money(a.repairCosts)})`} />
            <Stat label="Financing" value={`(${money(a.financing.total)})`} />
            <Stat label="Holding" value={`(${money(a.holding.total)})`} />
            <Stat label="Buying transaction" value={`(${money(a.buying.total)})`} />
            <Stat label="Selling transaction" value={`(${money(a.selling.total)})`} />
            <Stat label="Net profit" value={money(a.netProfit)} tone={a.netProfit > 0 ? "good" : "bad"} />
            <Stat label="Cash invested (financing plus holding)" value={money(a.cashInvested)} />
            <Stat label="ROI on cash" value={multiple(a.roiOnCash)} />
          </CardBody></Card>
          <Card><CardHeader title="Cost breakdown" /><CardBody>
            <Stat label="First lien points" value={money(a.financing.firstPointsPaid)} />
            <Stat label="First lien interest" value={money(a.financing.firstInterestPaid + a.financing.firstInterestOnlyPaid)} />
            <Stat label="Second lien" value={money(a.financing.secondPointsPaid + a.financing.secondInterestPaid + a.financing.secondInterestOnlyPaid)} />
            <Stat label="Property taxes" value={money(a.holding.propertyTaxesTotal)} />
            <Stat label="Insurance" value={money(a.holding.insuranceTotal)} />
            <Stat label="Utilities" value={money(a.holding.utilitiesTotal + a.holding.gasTotal + a.holding.waterTotal + a.holding.electricityTotal + a.holding.miscUtilitiesTotal)} />
            <Stat label="Buy: escrow, title, misc" value={money(a.buying.total)} />
            <Stat label="Sell: escrow, recording, realtor, transfer" value={money(a.selling.escrow + a.selling.recording + a.selling.realtor + a.selling.transfer)} />
            <Stat label="Sell: warranty, staging, marketing, misc" value={money(a.selling.homeWarranty + a.selling.staging + a.selling.marketing + a.selling.misc)} />
            <Stat label="Delayed draw ROI" value={multiple(a.delayed.actualRoi)} hint={`Cash to cover ${money(a.delayed.cashToCover)}`} />
            <Stat label="Up front draw ROI" value={multiple(a.upfront.actualRoi)} hint={`Cash to cover ${money(a.upfront.cashToCover)}`} />
          </CardBody></Card>
        </div>
      ) : null}

      {tab === "cashflow" ? (
        <Card>
          <CardHeader title="Weekly cash flow" description={`${flow.cashFlow.durationWeeks} week hold · lender draws at weeks ${flow.cashFlow.drawWeeks.join(", ")} · minimum balance ${money(flow.cashFlow.minBalance)} in week ${flow.cashFlow.minBalanceWeek}`} actions={
            <div className="flex gap-1">{(["delayed", "upfront"] as const).map((s) => <button key={s} type="button" onClick={() => setSchedule(s)} className={cn("rounded-md px-2 py-1 text-xs border", schedule === s ? "bg-accent text-accent-fg border-accent" : "border-border")}>{s === "delayed" ? "Delayed draws" : "Up front draws"}</button>)}</div>
          } />
          <CardBody>
            {flow.cashFlow.warnings.length ? <div className="mb-2 text-xs text-warn">{flow.cashFlow.warnings.join(" ")}</div> : null}
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={flow.cashFlow.weeks} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                  <CartesianGrid stroke="#eeece7" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#8a877f" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#8a877f" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={40} />
                  <Tooltip formatter={(v: number) => money(v, { cents: true })} labelFormatter={(l) => `Week ${l}`} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e6e4df" }} />
                  <ReferenceLine y={0} stroke="#b91c1c" strokeDasharray="3 3" />
                  <ReferenceLine x={flow.cashFlow.minBalanceWeek} stroke="#f59e0b" strokeDasharray="2 2" label={{ value: "min", fontSize: 10, fill: "#b45309" }} />
                  <Line type="monotone" dataKey="balance" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="max-h-72 overflow-auto scrollbar-thin mt-3 border border-border rounded-md">
              <Table>
                <THead><tr><TH>Week</TH><TH right>Cash in</TH><TH right>Expenses</TH><TH right>Balance</TH></tr></THead>
                <TBody>{flow.cashFlow.weeks.map((r) => <TR key={r.week} className={r.balance < 0 ? "bg-bad-soft/40" : ""}><TD>{r.week}</TD><TD right>{r.cashIn ? money(r.cashIn) : ""}</TD><TD right>{r.expenses ? money(r.expenses) : ""}</TD><TD right className={r.balance < 0 ? "text-bad" : ""}>{money(r.balance)}</TD></TR>)}</TBody>
              </Table>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <Stat label="Beginning cash" value={money(a.cashInvested)} />
              <Stat label="Ending balance" value={money(flow.cashFlow.endingBalance)} />
              <Stat label="Excess cash" value={money(flow.cashFlow.excessCash)} tone={flow.cashFlow.excessCash > 0 ? "good" : "bad"} />
              <Stat label="Actual ROI" value={multiple(flow.actualRoi)} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {tab === "rehab" ? (
        <Card>
          <CardHeader title="Rehab estimate" description={`${outputs.rehab.lineTotals.filter((v) => v > 0).length} items · ${money(outputs.rehab.total)} total${inputs.acquisitions.repairCostsOverride != null ? ` · override ${money(inputs.acquisitions.repairCostsOverride)} in use` : ""}`} />
          <CardBody className="p-0">
            <Table>
              <THead><tr><TH>Item</TH><TH>Option</TH><TH right>Qty</TH><TH right>Unit</TH><TH right>Total</TH></tr></THead>
              <TBody>{inputs.rehab.lines.map((l, i) => (outputs.rehab.lineTotals[i] ?? 0) > 0 ? <TR key={l.row}><TD>{l.question ?? ""}</TD><TD>{l.option}</TD><TD right>{l.quantity}</TD><TD right>{money(l.unitCost)}</TD><TD right className="font-medium">{money(outputs.rehab.lineTotals[i])}</TD></TR> : null)}</TBody>
            </Table>
            {outputs.rehab.total === 0 ? <p className="p-4 text-[13px] text-fg-3">Mark items Yes in the Rehab section to build the estimate.</p> : null}
          </CardBody>
        </Card>
      ) : null}

      {tab === "rental" && outputs.buyAndHold ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Card><CardHeader title="Current rents" /><CardBody>
            <Stat label="Gross rent per month" value={money(outputs.buyAndHold.current.grossRents)} />
            <Stat label="Operating expenses" value={`(${money(outputs.buyAndHold.current.totalOperatingExpenses)})`} />
            <Stat label="Monthly NOI" value={money(outputs.buyAndHold.current.monthlyNoi)} />
            <Stat label="Mortgage" value={`(${money(outputs.buyAndHold.current.monthlyMortgage)})`} />
            <Stat label="Monthly cash flow" value={money(outputs.buyAndHold.current.monthlyNet)} tone={outputs.buyAndHold.current.monthlyNet > 0 ? "good" : "bad"} />
            <Stat label="Cap rate" value={percent(outputs.buyAndHold.current.capRate, 2)} />
            <Stat label="Cash on cash" value={percent(outputs.buyAndHold.current.annualizedRoi)} />
            <Stat label="DCR" value={outputs.buyAndHold.dcr.proForma.dcr.toFixed(2)} tone={outputs.buyAndHold.dcr.proFormaQualifies ? "good" : "bad"} hint={`Required ${outputs.buyAndHold.dcr.required}`} />
          </CardBody></Card>
          <Card><CardHeader title="Market rents and 5 year view" /><CardBody>
            <Stat label="Market monthly cash flow" value={money(outputs.buyAndHold.market.monthlyNet)} />
            <Stat label="Market cap rate" value={percent(outputs.buyAndHold.market.capRate, 2)} />
            <Stat label="Year 1 debt paydown" value={money(outputs.buyAndHold.debtPaydown[0]?.totalDebtPaydown)} />
            <Stat label="Year 5 value" value={money(outputs.buyAndHold.appreciation[4]?.estValue)} />
            <Stat label="Avg yearly tax savings" value={money(outputs.buyAndHold.avgYearlyTaxSavings)} />
            <Stat label="Year 1 total return" value={percent(outputs.buyAndHold.totalReturn[0]?.totalRoi)} />
            <Stat label="Year 5 market rent" value={money(outputs.buyAndHold.rentGrowth[4]?.marketRent)} />
          </CardBody></Card>
        </div>
      ) : null}

      {tab === "sensitivity" && outputs.sensitivity ? (
        <Card>
          <CardHeader title="Sensitivity: flip net profit" description="Rows change ARV, columns change repairs. Middle cell is the current case." />
          <CardBody className="p-0">
            <Table>
              <THead><tr><TH>ARV \ Repairs</TH>{outputs.sensitivity.colAxis.values.map((v) => <TH key={v} right>{money(v)}</TH>)}</tr></THead>
              <TBody>{outputs.sensitivity.cells.map((row, i) => (
                <TR key={i}><TD className="font-medium">{money(outputs.sensitivity!.rowAxis.values[i])}</TD>{row.map((c, j) => <TD key={j} right className={cn(c.netProfit > 0 ? "text-good" : "text-bad", i === 2 && j === 2 && "bg-brand-soft font-semibold")}>{money(c.netProfit)}</TD>)}</TR>
              ))}</TBody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      {tab === "compare" ? (
        <Card>
          <CardHeader title="Version comparison" description="Saved outputs of every version on this property" />
          <CardBody className="p-0">
            <Table>
              <THead><tr><TH>Metric</TH>{siblings.map((s) => <TH key={s.id} right className={s.id === currentId ? "text-fg" : ""}>v{s.version} {s.name}</TH>)}</tr></THead>
              <TBody>
                {([
                  ["ARV", (s: Sibling) => money(s.inputs.acquisitions.arv)], ["Offer", (s: Sibling) => money(s.inputs.acquisitions.purchasePrice)], ["Repairs", (s: Sibling) => money((s.outputs as DealOutputs).acquisitions?.repairCosts)],
                  ["MAO", (s: Sibling) => money((s.outputs as DealOutputs).wholesale?.maxAllowableOffer)], ["Investor price", (s: Sibling) => money((s.outputs as DealOutputs).wholesale?.investorBuyPrice)],
                  ["Spread", (s: Sibling) => money((s.outputs as DealOutputs).wholesale?.spread)], ["Flip net", (s: Sibling) => money((s.outputs as DealOutputs).acquisitions?.netProfit)],
                  ["ROI on cash", (s: Sibling) => multiple((s.outputs as DealOutputs).acquisitions?.roiOnCash)], ["Hold months", (s: Sibling) => String(s.inputs.acquisitions.holdMonths)], ["Status", (s: Sibling) => s.status.replace(/_/g, " ")],
                ] as [string, (s: Sibling) => string][]).map(([label, fn]) => (
                  <TR key={label}><TD className="text-fg-2">{label}</TD>{siblings.map((s) => <TD key={s.id} right className={s.id === currentId ? "font-medium" : ""}>{fn(s)}</TD>)}</TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="text-[11px] text-fg-3">{label}</div>
      <div className={cn("text-lg font-semibold num", tone === "good" && "text-good", tone === "bad" && "text-bad")}>{value}</div>
      {sub ? <div className="text-[11px] text-fg-3 truncate" title={sub}>{sub}</div> : null}
    </div>
  );
}
