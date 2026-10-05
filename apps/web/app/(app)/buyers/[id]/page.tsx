import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { documents } from "@dealcalc/db";
import { getDb } from "@/lib/db";
import { requireSession, can } from "@/lib/auth";
import { getBuyer } from "@/lib/data/buyers";
import { updateBuyer, updateCriteria, addPurchase, removePurchase, updateSubmission, deleteBuyer, setBuyerActive } from "@/lib/actions/buyers";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money, fullName, shortDate, percent } from "@/lib/utils";
import { SuggestCriteria } from "./suggest";
import { BuyerDocuments } from "./documents";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Buyer" };
const RESPONSE_LABEL: Record<string, string> = { none: "No response", interested: "Interested", pass: "Pass", offer: "Offer" };

export default async function BuyerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const detail = await getBuyer(session.orgId, id);
  if (!detail) notFound();
  const { buyer, criteria, purchases, submissions } = detail;
  const writable = can(session, "buyer:write");
  const db = await getDb();
  const docs = await db.select().from(documents).where(and(eq(documents.orgId, session.orgId), eq(documents.buyerId, id))).orderBy(desc(documents.createdAt));
  return (
    <>
      <PageHeader crumbs={[{ label: "Buyers", href: "/buyers" }, { label: buyer.company ?? fullName(buyer) }]} title={<span className="flex items-center gap-2">{buyer.company ?? fullName(buyer)}{!buyer.active ? <Badge tone="neutral">Inactive</Badge> : null}</span>} description={`${fullName(buyer)}${buyer.phones[0] ? ` · ${buyer.phones[0].number}` : ""}${buyer.emails[0] ? ` · ${buyer.emails[0].address}` : ""}`}
        actions={<>
          {writable ? <ActionButton action={setBuyerActive.bind(null, id, !buyer.active)} variant="outline" size="md" confirm={buyer.active ? "Deactivate this buyer? They stay on file but drop out of deal matching." : undefined}>{buyer.active ? "Deactivate" : "Reactivate"}</ActionButton> : null}
          {session.role === "admin" ? <ActionButton action={deleteBuyer.bind(null, id) as () => Promise<import("@/lib/actions/leads").ActionResult>} variant="ghost" size="md" className="text-bad" confirm="Delete this buyer and their history for good?">Delete</ActionButton> : null}
        </>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <Card>
            <CardHeader title="Buy box" description="What they buy, where, and on what terms. Deal matching scores state, county, ZIP, price, type, max percent of ARV, condition, occupancy, and minimum margin against the buyer's projected profit. Funding, closing speed, and the formula are for your reference." actions={writable ? <SuggestCriteria buyerId={id} /> : null} />
            <CardBody>
              <ActionForm action={updateCriteria.bind(null, id)} submitLabel="Save buy box" className="grid gap-3 sm:grid-cols-2">
                <Field label="States (comma separated)"><Input name="states" defaultValue={criteria?.states.join(", ")} disabled={!writable} /></Field>
                <Field label="Counties"><Input name="counties" defaultValue={criteria?.counties.join(", ")} disabled={!writable} placeholder="Baltimore City, Baltimore" /></Field>
                <Field label="ZIP codes"><Input name="zips" defaultValue={criteria?.zips.join(", ")} disabled={!writable} /></Field>
                <Field label="Property types"><Input name="propertyTypes" defaultValue={criteria?.propertyTypes.join(", ")} disabled={!writable} placeholder="Single Family, Rowhome" /></Field>
                <Field label="Price min"><Input name="priceMin" type="number" min={0} step="any" defaultValue={criteria?.priceMin ?? ""} disabled={!writable} /></Field>
                <Field label="Price max"><Input name="priceMax" type="number" min={0} step="any" defaultValue={criteria?.priceMax ?? ""} disabled={!writable} /></Field>
                <Field label="Max all in % of ARV"><Input name="arvPctMax" type="number" min={1} max={150} step="any" defaultValue={criteria?.arvPctMax ? Number((Number(criteria.arvPctMax) * 100).toFixed(2)) : ""} disabled={!writable} placeholder="70" /></Field>
                <Field label="Buying formula (their words)"><Input name="buyingFormula" defaultValue={criteria?.buyingFormula ?? ""} disabled={!writable} placeholder="70% of ARV minus repairs" /></Field>
                <Field label="Condition levels accepted (1 worst to 5 best)"><Input name="conditionLevels" defaultValue={criteria?.conditionLevels.join(", ")} disabled={!writable} placeholder="1, 2, 3" /></Field>
                <Field label="Occupancy accepted" hint="Any of: vacant, owner, tenant"><Input name="occupancyPrefs" defaultValue={criteria?.occupancyPrefs.join(", ")} disabled={!writable} placeholder="vacant, owner, tenant" /></Field>
                <Field label="Funding"><Select name="funding" defaultValue={criteria?.funding ?? "cash"} disabled={!writable}><option value="cash">Cash</option><option value="hard_money">Hard money</option><option value="conventional">Conventional</option><option value="mixed">Mixed</option></Select></Field>
                <Field label="Closes in (days)"><Input name="closesInDays" type="number" min={1} max={365} step={1} defaultValue={criteria?.closesInDays ?? ""} disabled={!writable} /></Field>
                <Field label="Minimum margin ($)"><Input name="minMarginAmount" type="number" min={0} step="any" defaultValue={criteria?.minMarginAmount ?? ""} disabled={!writable} /></Field>
                <Field label="Minimum margin (%)"><Input name="minMarginPct" type="number" min={0} max={100} step="any" defaultValue={criteria?.minMarginPct ? Number((Number(criteria.minMarginPct) * 100).toFixed(2)) : ""} disabled={!writable} /></Field>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="proofOfFundsOnFile" defaultChecked={criteria?.proofOfFundsOnFile} disabled={!writable} className="h-4 w-4" />Proof of funds on file</label>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="sightUnseen" defaultChecked={criteria?.sightUnseen} disabled={!writable} className="h-4 w-4" />Buys sight unseen</label>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Deals sent" description="Price is what this buyer was quoted." />
            <CardBody className="p-0 overflow-x-auto">
              {submissions.length === 0 ? <p className="p-4 text-[13px] text-fg-3">Nothing sent yet. Match a deal from an analysis.</p> : (
                <Table>
                  <THead><tr><TH>Property</TH><TH right>Quoted price</TH><TH>Sent</TH><TH>Opened</TH><TH>Response</TH><TH>Update</TH></tr></THead>
                  <TBody>{submissions.map((s) => (
                    <TR key={s.s.id}>
                      <TD><Link href={`/analyzer/${s.analysisId}`} className="hover:underline">{s.address}, {s.city}</Link></TD>
                      <TD right>{money(s.price)}</TD>
                      <TD className="text-fg-3">{s.s.sentAt ? `${shortDate(s.s.sentAt)} via ${s.s.sentVia}` : ""}</TD>
                      <TD className="text-fg-3">{s.s.token ? (s.s.openCount > 0 ? `${shortDate(s.s.firstOpenedAt)} · ${s.s.openCount} view${s.s.openCount === 1 ? "" : "s"}` : "Not opened yet") : "Not tracked"}</TD>
                      <TD><Badge tone={s.s.response === "offer" ? "good" : s.s.response === "interested" ? "info" : s.s.response === "pass" ? "bad" : "neutral"}>{RESPONSE_LABEL[s.s.response] ?? s.s.response}{s.s.response === "offer" && s.s.responseAmount ? ` ${money(s.s.responseAmount)}` : ""}</Badge></TD>
                      <TD>{writable ? (
                        <ActionForm action={updateSubmission.bind(null, s.s.id)} submitLabel="Save" size="sm" variant="ghost" inline className="flex items-center gap-1">
                          <Select name="response" aria-label="Buyer response" defaultValue={s.s.response} className="w-28 h-7 text-xs"><option value="none">No response</option><option value="interested">Interested</option><option value="offer">Offer</option><option value="pass">Pass</option></Select>
                          <Input name="responseAmount" type="number" min={1} step="any" placeholder="Offer $" aria-label="Offer amount" className="w-24 h-7 text-xs" />
                        </ActionForm>
                      ) : null}</TD>
                    </TR>
                  ))}</TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Contact" />
            <CardBody>
              <ActionForm action={updateBuyer.bind(null, id)} submitLabel="Save" variant="outline" size="sm" className="space-y-2">
                <Field label="Company"><Input name="company" defaultValue={buyer.company ?? ""} disabled={!writable} /></Field>
                <div className="grid grid-cols-2 gap-2"><Field label="First"><Input name="firstName" required maxLength={80} defaultValue={buyer.firstName} disabled={!writable} /></Field><Field label="Last"><Input name="lastName" defaultValue={buyer.lastName ?? ""} disabled={!writable} /></Field></div>
                <Field label="Phone"><Input name="phone" defaultValue={buyer.phones[0]?.number ?? ""} disabled={!writable} /></Field>
                <Field label="Email"><Input name="email" type="email" defaultValue={buyer.emails[0]?.address ?? ""} disabled={!writable} /></Field>
                <Field label="Website"><Input name="website" defaultValue={buyer.website ?? ""} disabled={!writable} /></Field>
                <Field label="Source"><Input name="source" maxLength={120} defaultValue={buyer.source ?? ""} disabled={!writable} /></Field>
                <Field label="Notes from buyer calls"><Textarea name="notes" defaultValue={buyer.notes ?? ""} disabled={!writable} /></Field>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="touched" disabled={!writable} className="h-4 w-4" />Mark contacted today</label>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Purchase history" />
            <CardBody>
              {purchases.length ? <ul className="text-[13px] space-y-1 mb-3">{purchases.map((p) => <li key={p.id} className="flex items-center justify-between gap-2"><span className="truncate min-w-0">{p.address ?? "Unknown"}{p.closedAt ? ` · ${shortDate(p.closedAt)}` : ""}</span><span className="flex items-center gap-1 shrink-0"><span className="num">{money(p.price)}</span>{writable ? <ActionButton action={removePurchase.bind(null, p.id)} variant="ghost" size="sm" className="text-fg-3" confirm="Remove this purchase from the history?">Remove</ActionButton> : null}</span></li>)}</ul> : <p className="text-xs text-fg-3 mb-3">No purchases logged.</p>}
              {writable ? (
                <ActionForm action={addPurchase.bind(null, id)} submitLabel="Add purchase" variant="outline" size="sm" resetOnSuccess className="space-y-2">
                  <Input name="address" placeholder="Address" aria-label="Purchase address" required maxLength={200} />
                  <div className="grid grid-cols-2 gap-2"><Input name="price" type="number" min={0} step="any" placeholder="Price" aria-label="Purchase price" /><Input name="closedAt" type="date" aria-label="Closing date" /></div>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
      <div className="mt-4">
        <BuyerDocuments buyerId={id} docs={docs} canWrite={writable} sessionProfileId={session.profileId} isAdmin={session.role === "admin"} />
      </div>
    </>
  );
}
