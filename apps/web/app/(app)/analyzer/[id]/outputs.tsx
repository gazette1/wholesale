"use client";
import { useState } from "react";
import type { DealInput } from "@dealcalc/engine";
import type { DealOutputs } from "@/lib/deal-run";
import type { Sibling } from "./editor";
import { Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, money, percent, multiple } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";

const TABS = ["offer", "flip", "cashflow", "rehab", "rental", "loan", "sensitivity", "compare"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = { offer: "Offers", flip: "Flip P&L", cashflow: "Cash flow", rehab: "Rehab", rental: "Buy and hold", loan: "Loan", sensitivity: "Sensitivity", compare: "Compare" };
const REHAB_SOURCE: Record<string, string> = { checklist: "checklist", manual: "manual estimate", perSqft: "per square foot" };

export function Outputs({ outputs, inputs, siblings, currentId, initialTab, onOpenSection }: { outputs: DealOutputs; inputs: DealInput; siblings: Sibling[]; currentId: string; initialTab?: string; onOpenSection?: (section: string) => void }) {
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(initialTab ?? "") ? (initialTab as Tab) : "offer");
  const [schedule, setSchedule] = useState<"delayed" | "upfront">("delayed");
  const [showAllPayments, setShowAllPayments] = useState(false);
  const a = outputs.acquisitions;
  const w = outputs.wholesale;
  const o = outputs.offers;
  const flow = schedule === "delayed" ? a.delayed : a.upfront;
  const arv = outputs.effectiveArv;
  const errors = outputs.issues.filter((i) => i.level === "error");
  const warns = outputs.issues.filter((i) => i.level === "warn");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Max allowable offer" value={money(w.maxAllowableOffer)} sub={`${percent(w.arvFactor)} of ARV less repairs and fee`} />
        <Kpi label="Spread to investor" value={money(w.spread)} tone={w.spread > 0 ? "good" : "bad"} sub={`Investor pays ${money(w.investorBuyPrice)}`} />
        <Kpi label="Flip net profit" value={money(a.netProfit)} tone={a.netProfit > 0 ? "good" : "bad"} sub={`ROI on cash ${multiple(a.roiOnCash)}`} />
        <Kpi label="Offer as % of ARV" value={percent(w.arvPct)} tone={w.arvPct <= 0.7 ? "good" : w.arvPct <= 0.8 ? undefined : "bad"} sub={`Repairs ${money(a.repairCosts)} (${REHAB_SOURCE[outputs.rehabPlan.source]})`} />
      </div>

      {outputs.issues.length ? (
        <div className={cn("rounded-lg border px-3 py-2 text-[13px]", errors.length ? "border-[#f3c0c0] bg-bad-soft" : "border-[#f3d9b0] bg-warn-soft")}>
          <div className={cn("font-medium", errors.length ? "text-bad" : "text-warn")}>{errors.length ? `${errors.length} ${errors.length === 1 ? "input needs" : "inputs need"} fixing` : `${warns.length} ${warns.length === 1 ? "thing" : "things"} to double check`}</div>
          <ul className="mt-1 space-y-0.5">
            {outputs.issues.map((i, k) => (
              <li key={k} className="flex items-start gap-2">
                <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full shrink-0", i.level === "error" ? "bg-bad" : "bg-warn")} />
                <span className="text-fg-2">{i.message}{onOpenSection ? <button type="button" onClick={() => onOpenSection(i.section)} className="ml-2 text-xs text-brand hover:underline">Open {i.section === "costs" ? "closing costs" : i.section === "rental" ? "buy and hold" : i.section}</button> : null}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div role="tablist" aria-label="Results" className="flex gap-1 border-b border-border overflow-x-auto scrollbar-thin">
        {TABS.filter((t) => t !== "compare" || siblings.length > 1).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("relative px-3 py-2 text-[13px] whitespace-nowrap", tab === t ? "font-medium text-fg" : "text-fg-3 hover:text-fg")}>{LABELS[t]}{tab === t ? <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-fg rounded-full" /> : null}</button>
        ))}
      </div>

      {tab === "offer" ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Card><CardHeader title="Offer math" description={o.arvSource === "comparables" ? `ARV is the average of ${o.comparableCount} comparables` : "ARV as entered"} /><CardBody>
              <Stat label="ARV" value={money(arv)} />
              <Stat label={`${percent(w.arvFactor)} of ARV`} value={money(arv * w.arvFactor)} />
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
          <Card>
            <CardHeader title="Quick offers" description={`Allowance ${money(o.allowance)} (${percent(o.offerPercent)} of ARV), assignment fee ${money(o.fee)} subtracted. A negative offer stays visible.`} actions={onOpenSection ? <Button type="button" size="sm" variant="ghost" onClick={() => onOpenSection("offers")}>Edit rates and comps</Button> : null} />
            <CardBody className="p-0">
              <Table>
                <THead><tr><TH>Scenario</TH><TH right>Repairs</TH><TH right>Offer</TH><TH right>% of ARV</TH><TH right>vs proposed</TH></tr></THead>
                <TBody>{o.lines.map((l) => {
                  const gap = l.offer - inputs.acquisitions.purchasePrice;
                  return (
                    <TR key={l.key} className={l.key === "linked" ? "bg-brand-soft/40" : ""}>
                      <TD className={l.key === "linked" ? "font-medium" : ""}>{l.label}{l.key === "linked" ? <span className="text-fg-3 font-normal"> ({REHAB_SOURCE[outputs.rehabPlan.source]})</span> : null}</TD>
                      <TD right>{money(l.repairs)}</TD>
                      <TD right className={cn("font-medium", l.offer < 0 && "text-bad")}>{money(l.offer)}</TD>
                      <TD right>{percent(l.pctOfArv)}</TD>
                      <TD right className={gap >= 0 ? "text-good" : "text-bad"}>{gap >= 0 ? `${money(gap)} room` : `${money(-gap)} over`}</TD>
                    </TR>
                  );
                })}</TBody>
              </Table>
            </CardBody>
          </Card>
          {o.sellerCurrentScore != null || o.sellerDesiredScore != null ? (
            <Card><CardHeader title="Seller value comparison" description="Outcome times probability, divided by months times effort. A comparison score, not an appraisal." /><CardBody>
              <Stat label="Seller's current path" value={o.sellerCurrentScore != null ? Math.round(o.sellerCurrentScore).toLocaleString() : "needs months and effort"} />
              <Stat label="With your offer" value={o.sellerDesiredScore != null ? Math.round(o.sellerDesiredScore).toLocaleString() : "needs months and effort"} />
              <Stat label="Difference in score" value={o.sellerScoreDifference != null ? Math.round(o.sellerScoreDifference).toLocaleString() : "add both cases"} tone={o.sellerScoreDifference == null ? "muted" : o.sellerScoreDifference > 0 ? "good" : "bad"} hint="Positive means your offer scores better for the seller than their current path" />
            </CardBody></Card>
          ) : null}
        </div>
      ) : null}

      {tab === "flip" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Card><CardHeader title="Profit and loss" description="Workbook Acquisitions Deal Analyzer" /><CardBody>
            <Stat label="Sale (ARV)" value={money(arv)} />
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
            <div className="flex gap-1" role="radiogroup" aria-label="Draw schedule">{(["delayed", "upfront"] as const).map((s) => <button key={s} type="button" role="radio" aria-checked={schedule === s} onClick={() => setSchedule(s)} className={cn("rounded-md px-2 py-1 text-xs border", schedule === s ? "bg-accent text-accent-fg border-accent" : "border-border")}>{s === "delayed" ? "Delayed draws" : "Up front draws"}</button>)}</div>
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
            {flow.cashFlow.minBalance < 0 ? <p className="mt-2 text-xs text-bad">The balance goes negative. Additional owner cash of {money(-flow.cashFlow.minBalance)} is needed by week {flow.cashFlow.minBalanceWeek}.</p> : null}
          </CardBody>
        </Card>
      ) : null}

      {tab === "rehab" ? (
        <div className="space-y-3">
          <Card>
            <CardHeader title="Rehab estimate" description={`Source: ${REHAB_SOURCE[outputs.rehabPlan.source]} · estimate in use ${money(outputs.rehabPlan.estimate)} · checklist total ${money(outputs.rehab.total)}`} actions={onOpenSection ? <Button type="button" size="sm" variant="ghost" onClick={() => onOpenSection("rehab")}>Edit checklist</Button> : null} />
            <CardBody className="p-0">
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center justify-between text-xs text-fg-2 mb-1"><span>{outputs.rehabPlan.completedCount} of {outputs.rehabPlan.includedCount} included items done</span><span className="num">{percent(outputs.rehabPlan.completion)}</span></div>
                <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(outputs.rehabPlan.completion * 100)}><div className="h-full bg-good rounded-full" style={{ width: `${Math.round(outputs.rehabPlan.completion * 100)}%` }} /></div>
              </div>
              <Table>
                <THead><tr><TH>Item</TH><TH>Option</TH><TH>Status</TH><TH right>Qty</TH><TH right>Unit</TH><TH right>Total</TH></tr></THead>
                <TBody>{inputs.rehab.lines.map((l, i) => l.answer === "Yes" ? (
                  <TR key={l.row}><TD>{l.question ?? (l.custom ? "Custom" : "")}</TD><TD>{l.option}{l.notes ? <div className="text-xs text-fg-3">{l.notes}</div> : null}</TD>
                    <TD><Badge tone={l.status === "done" ? "good" : l.status === "in_progress" ? "info" : "neutral"}>{l.status === "done" ? "Done" : l.status === "in_progress" ? "In progress" : "To do"}</Badge></TD>
                    <TD right>{l.quantity}</TD><TD right>{money(l.unitCost)}</TD><TD right className="font-medium">{(outputs.rehab.lineTotals[i] ?? 0) > 0 ? money(outputs.rehab.lineTotals[i]) : <span className="text-warn font-normal">Needs price or quantity</span>}</TD></TR>
                ) : null)}</TBody>
              </Table>
              {outputs.rehabPlan.includedCount === 0 ? <p className="p-4 text-[13px] text-fg-3">Mark items Yes in the Rehab section to build the checklist.</p> : null}
            </CardBody>
          </Card>
          {(inputs.progress ?? []).length ? (
            <Card><CardHeader title="Progress history" /><CardBody className="space-y-1.5">
              {(inputs.progress ?? []).map((e, i) => <div key={i} className="text-[13px]"><Badge tone="neutral" className="mr-2">{e.date}</Badge>{e.message}</div>)}
            </CardBody></Card>
          ) : null}
        </div>
      ) : null}

      {tab === "rental" ? (outputs.buyAndHold ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            {([["Current rents", outputs.buyAndHold.current, outputs.buyAndHold.dcr.actual, outputs.buyAndHold.dcr.actualQualifies], ["Market rents", outputs.buyAndHold.market, outputs.buyAndHold.dcr.proForma, outputs.buyAndHold.dcr.proFormaQualifies]] as const).map(([title, c, d, passes]) => (
              <Card key={title}><CardHeader title={title} actions={<Badge tone={passes ? "good" : "bad"}>DCR {passes ? "passes" : "fails"}</Badge>} /><CardBody>
                <Stat label="Gross rent per month" value={money(c.grossRents)} />
                <Stat label="Operating expenses" value={`(${money(c.totalOperatingExpenses)})`} />
                <Stat label="Monthly NOI" value={money(c.monthlyNoi)} />
                <Stat label="Mortgage" value={`(${money(c.monthlyMortgage)})`} />
                <Stat label="Monthly cash flow" value={money(c.monthlyNet)} tone={c.monthlyNet > 0 ? "good" : "bad"} />
                <Stat label="Cap rate" value={percent(c.capRate, 2)} />
                <Stat label="Cash on cash" value={percent(c.annualizedRoi)} />
                <Stat label="DCR" value={Number.isFinite(d.dcr) ? d.dcr.toFixed(2) : "n/a"} tone={passes ? "good" : "bad"} hint={`Required ${outputs.buyAndHold!.dcr.required}`} />
              </CardBody></Card>
            ))}
          </div>
          <Card><CardHeader title="Five year returns" description="Cash flow, debt paydown, tax savings, and appreciation as a percent of the down payment. Tax savings are separate from operating cash flow." /><CardBody className="p-0">
            <Table>
              <THead><tr><TH>Year</TH><TH right>Cash flow</TH><TH right>Debt paydown</TH><TH right>Tax savings</TH><TH right>Appreciation</TH><TH right>Total return</TH><TH right>Dollars</TH><TH right>Est. value</TH></tr></THead>
              <TBody>{outputs.buyAndHold.totalReturn.map((r, i) => (
                <TR key={r.year}><TD>{r.year}</TD><TD right>{percent(r.cashFlow)}</TD><TD right>{percent(r.debtPaydown)}</TD><TD right>{percent(r.taxSavings)}</TD><TD right>{percent(r.appreciation)}</TD><TD right className="font-medium">{percent(r.totalRoi)}</TD><TD right>{money(r.totalDollarReturn)}</TD><TD right>{money(outputs.buyAndHold!.appreciation[i]?.estValue)}</TD></TR>
              ))}</TBody>
            </Table>
          </CardBody></Card>
          <Card><CardHeader title={`${outputs.buyAndHold.rentGrowth.length} year rent growth`} description="Market rent per month at the assumed growth rate. Fixed dollar expenses stay constant." /><CardBody>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={outputs.buyAndHold.rentGrowth} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                  <CartesianGrid stroke="#eeece7" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: "#8a877f" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#8a877f" }} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} width={64} />
                  <Tooltip formatter={(v: number) => money(v)} labelFormatter={(l) => `Year ${l}`} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e6e4df" }} />
                  <Line type="monotone" dataKey="marketRent" name="Market rent" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardBody></Card>
        </div>
      ) : <Card><CardBody><p className="text-[13px] text-fg-3">Add at least one rental unit on the Buy and hold section to see the rental analysis.</p></CardBody></Card>) : null}

      {tab === "loan" ? (outputs.loan ? (
        <Card>
          <CardHeader title="Loan amortization" description={`${outputs.loan.rows.length} payments of ${money(outputs.loan.payment, { cents: true })}`} actions={onOpenSection ? <Button type="button" size="sm" variant="ghost" onClick={() => onOpenSection("loan")}>Edit loan</Button> : null} />
          <CardBody>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4">
              <Stat label="Monthly payment" value={money(outputs.loan.payment, { cents: true })} />
              <Stat label="Total interest" value={money(outputs.loan.totalInterest)} />
              <Stat label="Total paid" value={money(outputs.loan.totalPaid)} />
              <Stat label={outputs.loan.payoffAfterPayment ? `Balance after payment ${outputs.loan.payoffAfterPayment}` : "Payoff lookup"} value={outputs.loan.payoffBalance != null ? money(outputs.loan.payoffBalance, { cents: true }) : "not set"} hint={outputs.loan.payoffDate ? `On ${outputs.loan.payoffDate}, interest paid so far ${money(outputs.loan.interestPaidByPayoff)}` : undefined} />
            </div>
            <div className="max-h-96 overflow-auto scrollbar-thin mt-3 border border-border rounded-md">
              <Table>
                <THead><tr><TH>#</TH><TH>Date</TH><TH right>Beginning</TH><TH right>Payment</TH><TH right>Principal</TH><TH right>Interest</TH><TH right>Ending</TH><TH right>Cum. interest</TH></tr></THead>
                <TBody>{(showAllPayments ? outputs.loan.rows : outputs.loan.rows.slice(0, 24)).map((r) => (
                  <TR key={r.number} className={r.number === outputs.loan!.payoffAfterPayment ? "bg-brand-soft/50" : ""}><TD>{r.number}</TD><TD>{r.date}</TD><TD right>{money(r.beginning, { cents: true })}</TD><TD right>{money(r.payment, { cents: true })}</TD><TD right>{money(r.principal, { cents: true })}</TD><TD right>{money(r.interest, { cents: true })}</TD><TD right>{money(r.ending, { cents: true })}</TD><TD right>{money(r.cumulativeInterest, { cents: true })}</TD></TR>
                ))}</TBody>
              </Table>
            </div>
            {outputs.loan.rows.length > 24 ? <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setShowAllPayments((v) => !v)}>{showAllPayments ? "Show the first 24 payments" : `Show all ${outputs.loan.rows.length} payments`}</Button> : null}
          </CardBody>
        </Card>
      ) : (
        <Card><CardBody className="space-y-2">
          <p className="text-[13px] text-fg-3">{outputs.loanError ?? "No loan has been set up for this analysis."}</p>
          {onOpenSection ? <Button type="button" size="sm" variant="outline" onClick={() => onOpenSection("loan")}>Open the Loan section</Button> : null}
        </CardBody></Card>
      )) : null}

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
                  ["ARV", (s: Sibling) => money((s.outputs as DealOutputs).effectiveArv ?? s.inputs.acquisitions.arv)], ["Offer", (s: Sibling) => money(s.inputs.acquisitions.purchasePrice)], ["Repairs", (s: Sibling) => money((s.outputs as DealOutputs).acquisitions?.repairCosts)],
                  ["MAO", (s: Sibling) => money((s.outputs as DealOutputs).wholesale?.maxAllowableOffer)], ["Investor price", (s: Sibling) => money((s.outputs as DealOutputs).wholesale?.investorBuyPrice)],
                  ["Spread", (s: Sibling) => money((s.outputs as DealOutputs).wholesale?.spread)], ["Flip net", (s: Sibling) => money((s.outputs as DealOutputs).acquisitions?.netProfit)],
                  ["ROI on cash", (s: Sibling) => multiple((s.outputs as DealOutputs).acquisitions?.roiOnCash)], ["Hold months", (s: Sibling) => String(s.inputs.acquisitions.holdMonths)],
                  ["Strategy", (s: Sibling) => s.inputs.meta?.strategy ?? "wholesale"], ["Engine", (s: Sibling) => (s.outputs as DealOutputs).engineVersion ?? ""], ["Status", (s: Sibling) => s.status.replace(/_/g, " ")],
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
