import type { LeadDetail } from "@/lib/data/leads";
import { createOffer, updateOfferStatus } from "@/lib/actions/leads";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money, dateTime } from "@/lib/utils";

const TONE: Record<string, "neutral" | "info" | "good" | "bad" | "warn"> = { draft: "neutral", sent: "info", countered: "warn", accepted: "good", rejected: "bad", expired: "neutral" };

export function OffersTab({ detail, canWrite }: { detail: LeadDetail; canWrite: boolean }) {
  const approved = detail.analyses.find((a) => a.status === "approved_for_offer") ?? detail.analyses.find((a) => a.isPrimary);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader title="Offer history" />
          <CardBody className="p-0">
            {detail.offers.length === 0 ? <p className="p-4 text-[13px] text-fg-3">No offers yet.</p> : (
              <Table>
                <THead><tr><TH right>Amount</TH><TH>Type</TH><TH>Status</TH><TH>Sent</TH><TH right>Counter</TH><TH>Notes</TH><TH></TH></tr></THead>
                <TBody>
                  {detail.offers.map((o) => (
                    <TR key={o.id}>
                      <TD right className="font-medium">{money(o.amount)}</TD>
                      <TD>{o.type}</TD>
                      <TD><Badge tone={TONE[o.status] ?? "neutral"}>{o.status}</Badge></TD>
                      <TD className="text-fg-3">{o.sentAt ? `${dateTime(o.sentAt)}${o.sentVia ? ` via ${o.sentVia}` : ""}` : ""}</TD>
                      <TD right>{money(o.counterAmount)}</TD>
                      <TD className="text-fg-3 max-w-[220px] truncate">{o.notes}</TD>
                      <TD>
                        {canWrite && (o.status === "sent" || o.status === "countered") ? (
                          <div className="flex gap-1">
                            <ActionButton action={updateOfferStatus.bind(null, o.id, detail.lead.id, "accepted", undefined)} size="sm" variant="primary">Accepted</ActionButton>
                            <ActionButton action={updateOfferStatus.bind(null, o.id, detail.lead.id, "rejected", undefined)} size="sm">Rejected</ActionButton>
                          </div>
                        ) : null}
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
        <CardHeader title="Record an offer" description={approved ? `Approved analysis suggests ${money(approved.maxAllowableOffer)} max` : "Approve an analysis first for a guided number"} />
        <CardBody>
          {canWrite ? (
            <ActionForm action={createOffer.bind(null, detail.lead.id)} submitLabel="Record offer" resetOnSuccess className="space-y-2">
              <input type="hidden" name="analysisId" value={approved?.id ?? ""} />
              <Field label="Amount"><Input name="amount" type="number" step="500" required defaultValue={approved?.purchasePrice ?? ""} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Type"><Select name="type" defaultValue="cash"><option value="cash">Cash</option><option value="creative">Creative</option><option value="assignment">Assignment</option></Select></Field>
                <Field label="Status"><Select name="status" defaultValue="sent"><option value="sent">Sent</option><option value="draft">Draft</option></Select></Field>
              </div>
              <Field label="Sent via"><Select name="sentVia" defaultValue="phone"><option value="phone">Phone</option><option value="text">Text</option><option value="email">Email</option><option value="in_person">In person</option><option value="docusign">DocuSign</option></Select></Field>
              <Field label="Notes"><Textarea name="notes" placeholder="Terms, closing date, contingencies" /></Field>
            </ActionForm>
          ) : <p className="text-xs text-fg-3">Your role cannot record offers.</p>}
        </CardBody>
      </Card>
    </div>
  );
}
