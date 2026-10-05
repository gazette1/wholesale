"use client";
import { useState } from "react";
import type { ProjectOutputs } from "@dealcalc/engine";
import { Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { money, percent } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";

const BASIS: Record<string, string> = { fixed: "Fixed", pctPurchase: "% of purchase", pctSale: "% of sale", pctAsIs: "% of as is" };
const PENDING = "Not available yet";
const FIRST_WEEKS = 26;
const orPending = (v: number | null, format: (n: number) => string = money) => (v === null ? PENDING : format(v));
/** A cost shown as a negative. Zero stays zero so it does not print as minus zero. */
const cost = (n: number | null) => (n === null ? null : n === 0 ? 0 : -n);
const shortDate = (iso: string) => iso.slice(5).replace("-", "/");

export function ProjectOutputsTab({ project, workbookNetProfit, onEdit }: { project: ProjectOutputs | null | undefined; workbookNetProfit: number; onEdit?: () => void }) {
  const [showAllWeeks, setShowAllWeeks] = useState(false);
  if (!project) {
    return (
      <Card><CardBody className="space-y-2">
        <p className="text-[13px] text-fg-2">The project model is off for this analysis. It models any number of loans, fee lines with a basis, free form monthly holding lines, a weekly cash flow on calendar dates, and a year by year rental projection, the way the Mac app does.</p>
        <p className="text-[13px] text-fg-3">It is a preview and never changes the offers, the Flip P&L, or the workbook cash flow.</p>
        {onEdit ? <Button type="button" size="sm" variant="outline" onClick={onEdit}>Open the project model section</Button> : null}
      </CardBody></Card>
    );
  }
  const f = project.flip;
  const fin = project.financing;
  const flow = project.cashFlow.status === "computed" ? project.cashFlow.value : null;
  const flowReason = project.cashFlow.status === "pending" ? project.cashFlow.reason : "";
  const projection = project.rentalProjection?.status === "computed" ? project.rentalProjection.value : null;
  const projectionReason = project.rentalProjection?.status === "pending" ? project.rentalProjection.reason : "";
  const shownWeeks = flow ? (showAllWeeks ? flow.weeks : flow.weeks.slice(0, FIRST_WEEKS)) : [];
  return (
    <div className="space-y-3">
      <Alert tone="warn">Preview, rules version {project.modelVersion}. These figures come from the Mac app&apos;s model and are not approved. The Flip P&L tab stays the number of record ({money(workbookNetProfit)} net profit).</Alert>

      <Card>
        <CardHeader title="Project flip summary" description={fin.allCash ? "All cash purchase, no loans" : `${fin.loans.length} ${fin.loans.length === 1 ? "loan" : "loans"}`} actions={onEdit ? <Button type="button" size="sm" variant="ghost" onClick={onEdit}>Edit inputs</Button> : null} />
        <CardBody>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4">
            <Stat label="Net profit" value={orPending(f.netProfit)} tone={f.netProfit === null ? "muted" : f.netProfit > 0 ? "good" : "bad"} />
            <Stat label="Return on all costs" value={orPending(f.costRoi, percent)} />
            <Stat label="Return on purchase and rehab" value={orPending(f.purchaseRepairRoi, percent)} />
            <Stat label="Return on owner cash" value={orPending(f.cashRoi, percent)} tone={f.cashRoi === null ? "muted" : undefined} />
          </div>
          <Table className="mt-3">
            <TBody>
              {([["Sale", f.sale], ["Purchase", cost(f.purchase)], ["Buying costs", cost(f.buyingCosts)], ["Repairs", cost(f.repairs)], ["Holding", cost(f.holding)], ["Financing", cost(f.financing)], ["Selling costs", cost(f.selling)], ["Other income and expenses", f.otherNet]] as [string, number | null][]).map(([label, value]) => (
                <TR key={label}><TD className="text-fg-2">{label}</TD><TD right>{orPending(value)}</TD></TR>
              ))}
              <TR><TD className="font-medium">Total project costs</TD><TD right className="font-medium">{orPending(f.totalProjectCosts)}</TD></TR>
            </TBody>
          </Table>
        </CardBody>
      </Card>

      {fin.loans.length ? (
        <Card>
          <CardHeader title="Loans" description={`Owner cash toward the purchase ${money(fin.ownerCashAtPurchase)}`} />
          <CardBody>
            <Table>
              <THead><tr><TH>Loan</TH><TH right>Commitment</TH><TH right>Rehab drawn</TH><TH right>Points</TH><TH right>Fixed fees</TH><TH right>Interest</TH></tr></THead>
              <TBody>
                {fin.loans.map((l, i) => <TR key={i}><TD>{l.name || `Loan ${i + 1}`}</TD><TD right>{money(l.commitment)}</TD><TD right>{money(l.rehabDrawn)}</TD><TD right>{money(l.pointsPaid)}</TD><TD right>{money(l.fixedFees)}</TD><TD right>{orPending(l.interest)}</TD></TR>)}
                <TR><TD className="font-medium">Total</TD><TD right>{money(fin.totalPurchaseFunding + fin.totalRehabFunding)}</TD><TD right>{money(fin.totalRehabDrawn)}</TD><TD right colSpan={2}>{money(fin.pointsAndFees)}</TD><TD right className="font-medium">{orPending(fin.interest)}</TD></TR>
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Weekly project cash flow"
          description={flow ? `${flow.weeks.length} weeks, exit ${flow.exitDate}` : "Calendar weeks from the start date through the hold"}
          actions={flow && flow.weeks.length > FIRST_WEEKS ? <Button type="button" size="sm" variant="ghost" onClick={() => setShowAllWeeks((v) => !v)}>{showAllWeeks ? `Show the first ${FIRST_WEEKS} weeks` : `Show all ${flow.weeks.length} weeks`}</Button> : null}
        />
        <CardBody>
          {flow ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4">
                <Stat label="Cash profit" value={money(flow.cashProfit)} tone={flow.cashProfit > 0 ? "good" : "bad"} />
                <Stat label="Lowest balance" value={money(flow.minimumBalance)} tone={flow.minimumBalance < 0 ? "bad" : "good"} />
                <Stat label="Additional owner cash" value={money(flow.additionalCashNeeded)} />
                <Stat label="Total owner cash" value={money(flow.totalOwnerCashRequired)} />
              </div>
              <div className="h-56 mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={flow.weeks} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                    <CartesianGrid stroke="#eeece7" vertical={false} />
                    <XAxis dataKey="number" tick={{ fontSize: 11, fill: "#8a877f" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#8a877f" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={40} />
                    <Tooltip formatter={(v: number) => money(v, { cents: true })} labelFormatter={(l) => `Week ${l}`} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e6e4df" }} />
                    <ReferenceLine y={0} stroke="#b91c1c" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="ending" name="Ending balance" stroke="#2563eb" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="max-h-72 overflow-auto scrollbar-thin mt-3 border border-border rounded-md">
                <Table>
                  <THead><tr><TH>Week</TH><TH>Date</TH><TH right>Cash in</TH><TH right>Cash out</TH><TH right>Ending balance</TH><TH right>Lowest so far</TH></tr></THead>
                  <TBody>
                    {shownWeeks.map((w) => (
                      <TR key={w.number} className={w.ending < 0 ? "bg-bad-soft/40" : ""}>
                        <TD>{w.number}</TD><TD className="text-fg-3">{shortDate(w.date)}</TD>
                        <TD right>{w.cashIn ? money(w.cashIn) : ""}</TD><TD right>{w.cashOut ? money(w.cashOut) : ""}</TD>
                        <TD right className={w.ending < 0 ? "text-bad" : ""}>{money(w.ending)}</TD><TD right className="text-fg-3">{money(w.minimumBalance)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
              {!showAllWeeks && flow.weeks.length > FIRST_WEEKS ? <p className="text-xs text-fg-3 mt-2">Showing the first {FIRST_WEEKS} of {flow.weeks.length} weeks.</p> : null}
            </>
          ) : (
            <div className="space-y-1">
              <p className="text-[13px] text-fg-2">{PENDING}</p>
              <p className="text-xs text-fg-3">{flowReason}</p>
            </div>
          )}
        </CardBody>
      </Card>

      {flow ? (
        <Card>
          <CardHeader title="Cash profit reconciliation" description="Every dollar the weekly cash flow moved, back to the project net profit" />
          <CardBody>
            <Table>
              <TBody>
                {flow.reconciliation.map((line) => <TR key={line.label}><TD className="text-fg-2">{line.label}</TD><TD right className={line.amount < 0 ? "text-fg-2" : ""}>{money(line.amount)}</TD></TR>)}
                <TR><TD className="font-medium">Cash profit</TD><TD right className="font-medium">{money(flow.cashProfit)}</TD></TR>
                <TR><TD className="text-fg-3">Project net profit above</TD><TD right className="text-fg-3">{orPending(f.netProfit)}</TD></TR>
              </TBody>
            </Table>
            <p className="text-xs text-fg-3 mt-2">Financing costs in the reconciliation are {money(flow.interest)} of interest and {money(flow.pointsAndFees)} of points and lender fees, {money(flow.financingCosts)} together.</p>
          </CardBody>
        </Card>
      ) : null}

      {project.rentalProjection ? (
        <Card>
          <CardHeader title="Rental projection" description={projection ? `${projection.years.length} years on ${money(projection.initialCash)} of owner cash` : "Year by year hold returns"} />
          <CardBody>
            {projection ? (
              <>
                <p className="text-xs text-fg-3 mb-2">Owner cash is the down payment {money(projection.downPayment)} plus closing costs {money(projection.closingCosts)} plus owner funded initial rehab {money(projection.ownerFundedRehab)}. Operating cash flow is rent less operating expenses less debt service. The estimated tax savings sit outside it.</p>
                <div className="max-h-96 overflow-auto scrollbar-thin border border-border rounded-md">
                  <Table>
                    <THead><tr><TH>Year</TH><TH right>Rent</TH><TH right>Operating expenses</TH><TH right>Cash flow</TH><TH right>Paydown</TH><TH right>Appreciation</TH><TH right>Tax savings</TH><TH right>Annual total</TH><TH right>Cumulative return</TH></tr></THead>
                    <TBody>
                      {projection.years.map((y) => (
                        <TR key={y.year}>
                          <TD>{y.year}</TD><TD right>{money(y.rent)}</TD><TD right>{money(y.operatingExpenses)}</TD>
                          <TD right className={y.cashFlow < 0 ? "text-bad" : ""}>{money(y.cashFlow)}</TD>
                          <TD right>{money(y.paydown)}</TD><TD right>{money(y.appreciation)}</TD><TD right>{money(y.taxSavings)}</TD>
                          <TD right className="font-medium">{money(y.annualTotal)}</TD><TD right>{percent(y.cumulativeRoi)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <p className="text-[13px] text-fg-2">{PENDING}</p>
                <p className="text-xs text-fg-3">{projectionReason}</p>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {project.buyingFees.lines.length || project.sellingFees.lines.length || project.holding.lines.length ? (
        <Card>
          <CardHeader title="Fee and holding lines" />
          <CardBody>
            <Table>
              <THead><tr><TH>Line</TH><TH>Kind</TH><TH right>Amount</TH></tr></THead>
              <TBody>
                {project.buyingFees.lines.map((l, i) => <TR key={`b${i}`}><TD>{l.name || "Buying fee"}</TD><TD className="text-fg-3">Buying, {BASIS[l.basis]}</TD><TD right>{money(l.amount)}</TD></TR>)}
                {project.sellingFees.lines.map((l, i) => <TR key={`s${i}`}><TD>{l.name || "Selling fee"}</TD><TD className="text-fg-3">Selling, {BASIS[l.basis]}</TD><TD right>{money(l.amount)}</TD></TR>)}
                {project.holding.lines.map((l, i) => <TR key={`h${i}`}><TD>{l.name || "Holding cost"}</TD><TD className="text-fg-3">{money(l.monthly)} a month for {project.holding.months} {project.holding.months === 1 ? "month" : "months"}</TD><TD right>{money(l.total)}</TD></TR>)}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      {project.pending.length ? (
        <Card>
          <CardHeader title="Not available yet" description="Each item names what it is waiting for" />
          <CardBody>
            <ul className="space-y-1.5 text-[13px]">
              {project.pending.map((p) => <li key={p.module} className="flex items-start gap-2"><Badge tone="warn">Pending</Badge><span className="text-fg-2">{p.reason}</span></li>)}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
