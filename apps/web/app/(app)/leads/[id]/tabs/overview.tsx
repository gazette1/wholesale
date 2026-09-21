import Link from "next/link";
import type { LeadDetail } from "@/lib/data/leads";
import { updateLeadFields, updateConsent, toggleTag, addTask } from "@/lib/actions/leads";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { KeyValue } from "@/components/ui/misc";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { money, fullName, num, shortDate, relative } from "@/lib/utils";
import { TaskList } from "../task-list";
import { TzOffset } from "@/components/ui/tz-offset";

const ISSUES: { key: string; label: string }[] = [
  { key: "dirty_title", label: "Dirty title" }, { key: "probate_or_inherited", label: "Probate or inherited" }, { key: "liens_or_judgments", label: "Liens or judgments" },
  { key: "mortgage_default_or_foreclosure", label: "Mortgage default or foreclosure" }, { key: "code_violations", label: "Code violations" }, { key: "poor_condition", label: "Poor condition" },
  { key: "occupied_by_tenant", label: "Occupied by tenant" }, { key: "occupied_by_squatter", label: "Occupied by squatter" }, { key: "seller_urgency", label: "Seller urgency" },
  { key: "divorce_or_partner_dispute", label: "Divorce or partner dispute" }, { key: "tax_delinquent", label: "Tax delinquent" }, { key: "hoarder_or_environmental", label: "Hoarder or environmental" }, { key: "other", label: "Other complexity" },
];

export function OverviewTab({ detail, sources, tags, canWrite }: { detail: LeadDetail; sources: { id: string; name: string }[]; tags: { id: string; name: string; color: string | null; kind: string }[]; canWrite: boolean }) {
  const { lead, property, primaryContact, report } = detail;
  const issues = (lead.dealIssues ?? {}) as Record<string, { flagged?: boolean; note?: string } | number>;
  const messy = Number((issues as any).messyScore ?? 0);
  const primaryAnalysis = detail.analyses.find((a) => a.isPrimary) ?? detail.analyses[0];
  const suggestion = detail.activities.find((a) => a.a.type === "system" && (a.a.payload as any)?.suggestions);
  const suggestions = suggestion ? ((suggestion.a.payload as any).suggestions as Record<string, number>) : null;
  const leadTagIds = new Set(detail.tags.map((t) => t.id));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader title="Seller" description={primaryContact ? `${primaryContact.relationship} · SMS consent ${primaryContact.smsConsent.replace("_", " ")}` : undefined} />
          <CardBody>
            {primaryContact ? (
              <>
                <KeyValue cols={4} items={[
                  { label: "Name", value: fullName(primaryContact) },
                  { label: "Phone", value: primaryContact.phones.map((p) => p.number).join(", ") || null },
                  { label: "Email", value: primaryContact.emails.map((e) => e.address).join(", ") || null },
                  { label: "Mailing", value: primaryContact.mailingAddress },
                ]} />
                {detail.contacts.length > 1 ? <div className="mt-3 text-xs text-fg-3">Also on this property: {detail.contacts.filter((c) => c.contact.id !== primaryContact.id).map((c) => `${fullName(c.contact)} (${c.link.role})`).join(", ")}</div> : null}
                {canWrite ? (
                  <ActionForm action={updateConsent.bind(null, primaryContact.id, lead.id)} submitLabel="Update consent" variant="outline" size="sm" className="mt-3 flex flex-wrap items-end gap-3">
                    <Field label="SMS consent"><Select name="smsConsent" defaultValue={primaryContact.smsConsent} className="w-40"><option value="unknown">Unknown</option><option value="opted_in">Opted in</option><option value="opted_out">Opted out</option></Select></Field>
                    <label className="flex items-center gap-2 text-[13px] h-8"><input type="checkbox" name="doNotContact" defaultChecked={primaryContact.doNotContact} className="h-4 w-4" />Do not contact</label>
                  </ActionForm>
                ) : null}
              </>
            ) : <p className="text-[13px] text-fg-3">No contact on this lead.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Property" actions={<Link href={`/properties/${property.id}/report`} className="text-xs text-brand hover:underline">Property report</Link>} />
          <CardBody>
            <KeyValue cols={4} items={[
              { label: "Type", value: property.propertyType }, { label: "Beds / baths", value: property.beds || property.baths ? `${property.beds ?? "?"} / ${property.baths ?? "?"}` : null },
              { label: "Sq ft", value: property.sqft ? num(property.sqft) : null }, { label: "Year built", value: property.yearBuilt },
              { label: "Occupancy", value: property.occupancy }, { label: "Condition", value: property.condition === "unknown" ? null : `${property.condition} of 5` },
              { label: "County", value: property.county }, { label: "Lot", value: property.lotSqft ? `${num(property.lotSqft)} sq ft` : null },
            ]} />
            {report ? (
              <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
                <Stat label="Estimated value" value={money(report.normalized.valuation.avm)} />
                <Stat label="ARV estimate" value={money(report.normalized.arv.estimate)} />
                <Stat label="Mortgage balance" value={money(report.normalized.mortgages.reduce((a, m) => a + (m.estimatedBalance ?? 0), 0))} />
                <Stat label="Owner" value={report.normalized.owner.names[0] ?? "Unknown"} />
                <Stat label="Years owned" value={report.normalized.owner.yearsOwned ?? "n/a"} />
                <Stat label="Distress flags" value={report.normalized.distress.flags.length ? report.normalized.distress.flags.join(", ") : "None"} tone={report.normalized.distress.flags.length ? "warn" : "muted"} />
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Deal issues" description={messy ? `${messy} flagged. Messy deals are where solving the problem creates the margin.` : "Flag what makes this deal complicated."} />
          <CardBody>
            {suggestions ? <p className="text-xs text-fg-3 mb-2">Suggested from notes: {Object.entries(suggestions).filter(([, p]) => p >= 0.5).map(([k, p]) => `${k.replace(/_/g, " ")} (${Math.round(p * 100)}%)`).join(", ") || "none"}</p> : null}
            <ActionForm action={updateLeadFields.bind(null, lead.id)} submitLabel="Save issues" variant="outline" size="sm">
              <input type="hidden" name="dealIssues" value="1" />
              <input type="hidden" name="issueKeys" value={ISSUES.map((i) => i.key).join(",")} />
              <div className="grid gap-2 sm:grid-cols-2">
                {ISSUES.map((i) => {
                  const v = issues[i.key] as { flagged?: boolean; note?: string } | undefined;
                  return (
                    <div key={i.key} className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2">
                      <input type="checkbox" name={`issue_${i.key}`} defaultChecked={Boolean(v?.flagged)} disabled={!canWrite} className="mt-0.5 h-4 w-4" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px]">{i.label}</div>
                        <input name={`issue_note_${i.key}`} defaultValue={v?.note ?? ""} placeholder="Note" disabled={!canWrite} className="mt-1 w-full bg-transparent text-xs text-fg-2 placeholder:text-fg-3 focus:outline-none border-b border-transparent focus:border-border" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Deal at a glance" />
          <CardBody>
            <Stat label="Asking price" value={money(lead.askingPrice) || "Not stated"} />
            <Stat label="Motivation" value={lead.motivationScore != null ? `${lead.motivationScore} / 10` : "n/a"} />
            <Stat label="Urgency" value={lead.sellerUrgency} />
            <Stat label="Contact attempts" value={lead.contactAttempts} />
            <Stat label="First response" value={lead.firstResponseMinutes != null ? (lead.firstResponseMinutes < 60 ? `${lead.firstResponseMinutes} min` : `${(lead.firstResponseMinutes / 60).toFixed(1)} h`) : "No reply yet"} />
            {primaryAnalysis ? (
              <>
                <Stat label="Max allowable offer" value={money(primaryAnalysis.maxAllowableOffer)} />
                <Stat label="Projected spread" value={money(primaryAnalysis.spread)} tone={Number(primaryAnalysis.spread) > 0 ? "good" : "bad"} />
                <Stat label="Flip net profit" value={money(primaryAnalysis.netProfit)} tone={Number(primaryAnalysis.netProfit) > 0 ? "good" : "bad"} />
              </>
            ) : <p className="text-xs text-fg-3 mt-2">No analysis yet. Open the Analyzer tab.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Lead details" />
          <CardBody>
            <ActionForm action={updateLeadFields.bind(null, lead.id)} submitLabel="Save" variant="outline" size="sm" className="space-y-3">
              <Field label="Asking price"><Input name="askingPrice" type="number" step="1000" defaultValue={lead.askingPrice ?? ""} disabled={!canWrite} /></Field>
              <Field label="Motivation (1 to 10)"><Input name="motivationScore" type="number" min="1" max="10" defaultValue={lead.motivationScore ?? ""} disabled={!canWrite} /></Field>
              <Field label="Seller urgency"><Select name="sellerUrgency" defaultValue={lead.sellerUrgency} disabled={!canWrite}><option value="none">Not stated</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="immediate">Immediate</option></Select></Field>
              <Field label="Source"><Select name="sourceId" defaultValue={lead.sourceId ?? ""} disabled={!canWrite}><option value="">Unknown</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              {lead.status === "lost" || lead.status === "nurture" ? <Field label="Lost reason"><Input name="lostReason" defaultValue={lead.lostReason ?? ""} disabled={!canWrite} /></Field> : null}
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tags" />
          <CardBody className="flex flex-wrap gap-1.5">
            {tags.filter((t) => t.kind !== "issue").map((t) => {
              const on = leadTagIds.has(t.id);
              return canWrite ? (
                <ActionButton key={t.id} action={toggleTag.bind(null, lead.id, t.id, !on)} variant={on ? "default" : "outline"} size="sm">{t.name}</ActionButton>
              ) : on ? <Badge key={t.id} tone="brand">{t.name}</Badge> : null;
            })}
            {detail.tags.filter((t) => t.kind === "issue").map((t) => <Badge key={t.id} tone="warn">{t.name}</Badge>)}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Follow ups" />
          <CardBody>
            <TaskList tasks={detail.tasks.map((t) => ({ id: t.t.id, title: t.t.title, kind: t.t.kind, dueAt: t.t.dueAt?.toISOString() ?? null, doneAt: t.t.doneAt?.toISOString() ?? null, assignee: t.assignee }))} />
            <ActionForm action={addTask.bind(null, lead.id)} submitLabel="Add follow up" variant="outline" size="sm" resetOnSuccess className="mt-3 space-y-2">
              <Input name="title" placeholder="Call back about payoff" required />
              <div className="flex gap-2">
                <Select name="kind" defaultValue="call" className="w-28"><option value="call">Call</option><option value="text">Text</option><option value="email">Email</option><option value="visit">Visit</option><option value="other">Other</option></Select>
                <TzOffset /><Input name="dueAt" type="datetime-local" className="flex-1" />
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
