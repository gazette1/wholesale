import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { getBuyer } from "@/lib/data/buyers";
import { updateBuyer, updateCriteria, addPurchase, updateSubmission, deleteBuyer } from "@/lib/actions/buyers";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money, fullName, shortDate, percent } from "@/lib/utils";
import { SuggestCriteria } from "./suggest";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Buyer" };

export default async function BuyerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const detail = await getBuyer(session.orgId, id);
  if (!detail) notFound();
  const { buyer, criteria, purchases, submissions } = detail;
  const writable = can(session, "buyer:write");
  return (
    <>
      <PageHeader crumbs={[{ label: "Buyers", href: "/buyers" }, { label: buyer.company ?? fullName(buyer) }]} title={<span className="flex items-center gap-2">{buyer.company ?? fullName(buyer)}{!buyer.active ? <Badge tone="neutral">Inactive</Badge> : null}</span>} description={`${fullName(buyer)}${buyer.phones[0] ? ` · ${buyer.phones[0].number}` : ""}${buyer.emails[0] ? ` · ${buyer.emails[0].address}` : ""}`}
        actions={session.role === "admin" ? <ActionButton action={deleteBuyer.bind(null, id) as () => Promise<import("@/lib/actions/leads").ActionResult>} variant="ghost" size="md" className="text-bad" confirm="Delete this buyer and their history?">Delete</ActionButton> : null} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader title="Buy box" description="What they buy, where, and on what terms. Deal matching uses every field." actions={writable ? <SuggestCriteria buyerId={id} /> : null} />
            <CardBody>
              <ActionForm action={updateCriteria.bind(null, id)} submitLabel="Save buy box" className="grid gap-3 sm:grid-cols-2">
                <Field label="States (comma separated)"><Input name="states" defaultValue={criteria?.states.join(", ")} disabled={!writable} /></Field>
                <Field label="Counties"><Input name="counties" defaultValue={criteria?.counties.join(", ")} disabled={!writable} placeholder="Baltimore City, Baltimore" /></Field>
                <Field label="ZIP codes"><Input name="zips" defaultValue={criteria?.zips.join(", ")} disabled={!writable} /></Field>
                <Field label="Property types"><Input name="propertyTypes" defaultValue={criteria?.propertyTypes.join(", ")} disabled={!writable} placeholder="Single Family, Rowhome" /></Field>
                <Field label="Price min"><Input name="priceMin" type="number" step={5000} defaultValue={criteria?.priceMin ?? ""} disabled={!writable} /></Field>
                <Field label="Price max"><Input name="priceMax" type="number" step={5000} defaultValue={criteria?.priceMax ?? ""} disabled={!writable} /></Field>
                <Field label="Max all in % of ARV"><Input name="arvPctMax" type="number" step={1} defaultValue={criteria?.arvPctMax ? Math.round(Number(criteria.arvPctMax) * 100) : ""} disabled={!writable} placeholder="70" /></Field>
                <Field label="Buying formula (their words)"><Input name="buyingFormula" defaultValue={criteria?.buyingFormula ?? ""} disabled={!writable} placeholder="70% of ARV minus repairs" /></Field>
                <Field label="Condition levels accepted (1 worst to 5 best)"><Input name="conditionLevels" defaultValue={criteria?.conditionLevels.join(", ")} disabled={!writable} placeholder="1, 2, 3" /></Field>
                <Field label="Occupancy accepted"><Input name="occupancyPrefs" defaultValue={criteria?.occupancyPrefs.join(", ")} disabled={!writable} placeholder="vacant, owner, tenant" /></Field>
                <Field label="Funding"><Select name="funding" defaultValue={criteria?.funding ?? "cash"} disabled={!writable}><option value="cash">Cash</option><option value="hard_money">Hard money</option><option value="conventional">Conventional</option><option value="mixed">Mixed</option></Select></Field>
                <Field label="Closes in (days)"><Input name="closesInDays" type="number" defaultValue={criteria?.closesInDays ?? ""} disabled={!writable} /></Field>
                <Field label="Minimum margin ($)"><Input name="minMarginAmount" type="number" step={1000} defaultValue={criteria?.minMarginAmount ?? ""} disabled={!writable} /></Field>
                <Field label="Minimum margin (%)"><Input name="minMarginPct" type="number" step={1} defaultValue={criteria?.minMarginPct ? Math.round(Number(criteria.minMarginPct) * 100) : ""} disabled={!writable} /></Field>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="proofOfFundsOnFile" defaultChecked={criteria?.proofOfFundsOnFile} disabled={!writable} className="h-4 w-4" />Proof of funds on file</label>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="sightUnseen" defaultChecked={criteria?.sightUnseen} disabled={!writable} className="h-4 w-4" />Buys sight unseen</label>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Deals sent" />
            <CardBody className="p-0">
              {submissions.length === 0 ? <p className="p-4 text-[13px] text-fg-3">Nothing sent yet. Match a deal from an analysis.</p> : (
                <Table>
                  <THead><tr><TH>Property</TH><TH right>Price</TH><TH right>Spread</TH><TH>Sent</TH><TH>Response</TH><TH>Update</TH></tr></THead>
                  <TBody>{submissions.map((s) => (
                    <TR key={s.s.id}>
                      <TD><Link href={`/analyzer/${s.analysisId}`} className="hover:underline">{s.address}, {s.city}</Link></TD>
                      <TD right>{money(s.price)}</TD><TD right>{money(s.spread)}</TD>
                      <TD className="text-fg-3">{s.s.sentAt ? `${shortDate(s.s.sentAt)} via ${s.s.sentVia}` : ""}</TD>
                      <TD><Badge tone={s.s.response === "offer" ? "good" : s.s.response === "interested" ? "info" : s.s.response === "pass" ? "bad" : "neutral"}>{s.s.response}{s.s.responseAmount ? ` ${money(s.s.responseAmount)}` : ""}</Badge></TD>
                      <TD>{writable ? (
                        <ActionForm action={updateSubmission.bind(null, s.s.id)} submitLabel="Save" size="sm" variant="ghost" inline className="flex items-center gap-1">
                          <Select name="response" defaultValue={s.s.response} className="w-28 h-7 text-xs"><option value="none">No response</option><option value="interested">Interested</option><option value="offer">Offer</option><option value="pass">Pass</option></Select>
                          <Input name="responseAmount" type="number" placeholder="$" className="w-24 h-7 text-xs" />
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
                <div className="grid grid-cols-2 gap-2"><Field label="First"><Input name="firstName" defaultValue={buyer.firstName} disabled={!writable} /></Field><Field label="Last"><Input name="lastName" defaultValue={buyer.lastName ?? ""} disabled={!writable} /></Field></div>
                <Field label="Phone"><Input name="phone" defaultValue={buyer.phones[0]?.number ?? ""} disabled={!writable} /></Field>
                <Field label="Email"><Input name="email" defaultValue={buyer.emails[0]?.address ?? ""} disabled={!writable} /></Field>
                <Field label="Website"><Input name="website" defaultValue={buyer.website ?? ""} disabled={!writable} /></Field>
                <Field label="Source"><Input name="source" defaultValue={buyer.source ?? ""} disabled={!writable} /></Field>
                <Field label="Notes from buyer calls"><Textarea name="notes" defaultValue={buyer.notes ?? ""} disabled={!writable} /></Field>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="touched" disabled={!writable} className="h-4 w-4" />Mark contacted today</label>
                <label className="flex items-center gap-2 text-[13px]"><input type="hidden" name="active" value={buyer.active ? "on" : "off"} /></label>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Purchase history" />
            <CardBody>
              {purchases.length ? <ul className="text-[13px] space-y-1 mb-3">{purchases.map((p) => <li key={p.id} className="flex justify-between"><span className="truncate">{p.address ?? "Unknown"}{p.closedAt ? ` · ${shortDate(p.closedAt)}` : ""}</span><span className="num">{money(p.price)}</span></li>)}</ul> : <p className="text-xs text-fg-3 mb-3">No purchases logged.</p>}
              {writable ? (
                <ActionForm action={addPurchase.bind(null, id)} submitLabel="Add purchase" variant="outline" size="sm" resetOnSuccess className="space-y-2">
                  <Input name="address" placeholder="Address" />
                  <div className="grid grid-cols-2 gap-2"><Input name="price" type="number" placeholder="Price" /><Input name="closedAt" type="date" /></div>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
