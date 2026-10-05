import type { LeadDetail } from "@/lib/data/leads";
import { createOffer } from "@/lib/actions/leads";
import { OfferActions } from "./offer-actions";
import { ActionForm } from "@/components/ui/action-form";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money, dateTime, shortDate } from "@/lib/utils";

const TONE: Record<string, "neutral" | "info" | "good" | "bad" | "warn"> = { draft: "neutral", sent: "info", countered: "warn", accepted: "good", rejected: "bad", expired: "neutral" };

export function OffersTab({ detail, canWrite }: { detail: LeadDetail; canWrite: boolean }) {
  const approved = detail.analyses.find((a) => a.status === "approved_for_offer") ?? detail.analyses.find((a) => a.isPrimary);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 min-w-0">
        <Card>
          <CardHeader title="Offer history" />
          <CardBody className="p-0 overflow-x-auto">
            {detail.offers.length === 0 ? <p className="p-4 text-[13px] text-fg-3">No offers yet.</p> : (
              <Table>
                <THead><tr><TH right>Amount</TH><TH>Type</TH><TH>Status</TH><TH>Sent</TH><TH>Expires</TH><TH right>Counter</TH><TH>Notes</TH><TH></TH></tr></THead>
                <TBody>
                  {detail.offers.map((o) => (
                    <TR key={o.id}>
                      <TD right className="font-medium">{money(o.amount)}</TD>
                      <TD>{o.type}</TD>
                      <TD><Badge tone={TONE[o.status] ?? "neutral"}>{o.status}</Badge></TD>
                      <TD className="text-fg-3">{o.sentAt ? `${dateTime(o.sentAt)}${o.sentVia ? ` via ${o.sentVia}` : ""}` : ""}</TD>
                      <TD className="text-fg-3">{o.expiresAt ? shortDate(o.expiresAt) : ""}</TD>
                      <TD right>{money(o.counterAmount)}</TD>
                      <TD className="text-fg-3 max-w-[220px] truncate">{o.notes}</TD>
                      <TD>
                        {canWrite ? <OfferActions offerId={o.id} leadId={detail.lead.id} status={o.status} /> : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Record an offer" description={approved ? `${approved.status === "approved_for_offer" ? "The approved analysis" : `The primary analysis (${approved.status.replace(/_/g, " ")}, not approved yet)`} puts the max allowable offer at ${money(approved.maxAllowableOffer)}` : "Create and approve an analysis first for a guided number"} />
        <CardBody>
          {canWrite ? (
            <ActionForm action={createOffer.bind(null, detail.lead.id)} submitLabel="Record offer" resetOnSuccess className="space-y-2">
              <input type="hidden" name="analysisId" value={approved?.id ?? ""} />
              <Field label="Amount"><Input name="amount" type="number" min={1} step="any" required defaultValue={approved?.purchasePrice ?? ""} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Type"><Select name="type" defaultValue="cash"><option value="cash">Cash</option><option value="creative">Creative</option><option value="assignment">Assignment</option></Select></Field>
                <Field label="Status"><Select name="status" defaultValue="sent"><option value="sent">Sent</option><option value="draft">Draft</option></Select></Field>
              </div>
              <Field label="Sent via"><Select name="sentVia" defaultValue="phone"><option value="phone">Phone</option><option value="text">Text</option><option value="email">Email</option><option value="in_person">In person</option><option value="docusign">DocuSign</option></Select></Field>
              <Field label="Expires" hint="Leave blank if this offer has no deadline"><Input name="expiresAt" type="date" /></Field>
              <Field label="Notes"><Textarea name="notes" maxLength={2000} placeholder="Terms, closing date, contingencies" /></Field>
            </ActionForm>
          ) : <p className="text-xs text-fg-3">Your role cannot record offers.</p>}
        </CardBody>
      </Card>
    </div>
  );
}
