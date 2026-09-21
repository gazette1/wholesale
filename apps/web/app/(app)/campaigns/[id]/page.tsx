import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { getCampaign, getCampaignName, listTemplates } from "@/lib/data/campaigns";
import { listStages } from "@/lib/data/leads";
import { addStep, removeStep, setCampaignStatus, enrollMatching, stopEnrollment, resumeEnrollment, updateCampaign, deleteCampaign } from "@/lib/actions/campaigns";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { dateTime, fullName } from "@/lib/utils";
import { SegmentFields } from "../segment-fields";

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "info"> = { draft: "neutral", active: "good", paused: "warn", done: "info" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const session = await requireSession();
  const { id } = await params;
  return { title: (await getCampaignName(session.orgId, id)) ?? "Campaign" };
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const detail = await getCampaign(session.orgId, id);
  if (!detail) notFound();
  const [allTemplates, stages] = await Promise.all([listTemplates(session.orgId), listStages(session.orgId)]);
  const templates = allTemplates.filter((t) => t.channel === detail.campaign.channel && t.active);
  const writable = can(session, "campaign:write");
  const { campaign, steps, enrollments, sent } = detail;
  const segment = (campaign.segment ?? {}) as { stageKeys?: string[]; maxAttempts?: number };
  const stageKeys = segment.stageKeys ?? [];
  const stageNames = stageKeys.map((k) => stages.find((s) => s.key === k)?.name ?? k).join(", ") || "any";
  const sentTotal = sent.reduce((a, s) => a + s.n, 0);
  const status = campaign.status;
  const first = steps.length === 0;
  return (
    <>
      <PageHeader crumbs={[{ label: "Campaigns", href: "/campaigns" }, { label: campaign.name }]} title={<span className="flex flex-wrap items-center gap-2 break-words">{campaign.name}<Badge tone={STATUS_TONE[status] ?? "neutral"}>{status}</Badge></span>}
        description={`${campaign.channel === "sms" ? "Text" : "Email"} campaign. Stages: ${stageNames}.${segment.maxAttempts != null ? ` At most ${segment.maxAttempts} contact attempts.` : ""}`}
        actions={writable ? <div className="flex flex-wrap items-start gap-2">
          {status === "draft" || status === "paused" ? <ActionButton action={setCampaignStatus.bind(null, id, "active")} variant="primary" size="md">Activate</ActionButton> : null}
          {status === "active" ? <ActionButton action={setCampaignStatus.bind(null, id, "paused")} size="md">Pause</ActionButton> : null}
          {status !== "done" ? <ActionButton action={enrollMatching.bind(null, id)} size="md">Enroll matching leads</ActionButton> : null}
          {status !== "done" ? <ActionButton action={setCampaignStatus.bind(null, id, "done")} size="md" confirm="Mark this campaign done? No more steps are sent until it is activated again.">Mark done</ActionButton> : null}
          {status === "paused" || status === "done" ? <ActionButton action={setCampaignStatus.bind(null, id, "draft")} size="md">Back to draft</ActionButton> : null}
        </div> : null} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 min-w-0">
          <Card className="min-w-0">
            <CardHeader title="Steps" description="Step 1 sends when a lead is enrolled. Each later step waits its delay after the previous send." />
            <CardBody className="space-y-2">
              {steps.map(({ step, template }, i) => (
                <div key={step.id} className="rounded-md border border-border p-2.5 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-x-2"><span className="text-[13px] font-medium break-words min-w-0">Step {i + 1} · {template.name}</span><span className="text-xs text-fg-3">{i === 0 ? "at enrollment" : `after ${step.delayHours}h`}</span></div>
                  <p className="text-xs text-fg-2 mt-1 line-clamp-3 break-words">{template.body}</p>
                  {writable ? <div className="mt-1"><ActionButton action={removeStep.bind(null, id, step.id)} variant="ghost" size="sm" confirm={`Remove step ${i + 1} from this campaign?`}>Remove</ActionButton></div> : null}
                </div>
              ))}
              {steps.length === 0 ? <p className="text-xs text-fg-3">No steps yet.</p> : null}
              {writable ? (
                <ActionForm action={addStep.bind(null, id)} submitLabel="Add step" variant="outline" size="sm" resetOnSuccess className="space-y-2 pt-2 border-t border-border">
                  <Field label="Template"><Select name="templateId" defaultValue={templates[0]?.id ?? ""}>{templates.length === 0 ? <option value="">No active templates for this channel</option> : null}{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
                  {templates.length === 0 ? <p className="text-xs text-fg-3">Create {campaign.channel === "sms" ? "a text" : "an email"} template on the <Link href="/templates" className="underline">Templates</Link> page first.</p> : null}
                  <Field label="Delay hours"><Input key={first ? "first" : "later"} name="delayHours" type="number" min={0} max={8760} step={1} defaultValue={first ? 0 : 24} disabled={first} /></Field>
                  <p className="text-xs text-fg-3">{first ? "The first step sends when a lead is enrolled, so it has no delay." : "Whole hours after the previous step, from 0 to 8760 (one year)."}</p>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
          {writable ? (
            <Card className="min-w-0">
              <CardHeader title="Edit campaign" description="The channel is fixed because the steps use templates for it." />
              <CardBody>
                <ActionForm action={updateCampaign.bind(null, id)} submitLabel="Save" variant="outline" size="sm" className="space-y-2">
                  <Field label="Name"><Input name="name" defaultValue={campaign.name} required maxLength={120} /></Field>
                  <SegmentFields stages={stages} selected={stageKeys} maxAttempts={segment.maxAttempts ?? null} />
                </ActionForm>
                <div className="mt-4 pt-3 border-t border-border">
                  <ActionButton action={deleteCampaign.bind(null, id)} variant="ghost" size="sm" className="text-bad" confirm="Delete this campaign, its steps, and its enrollments? This cannot be undone.">Delete campaign</ActionButton>
                  <p className="mt-1 text-xs text-fg-3">{sentTotal > 0 ? `This campaign has sent ${sentTotal} message${sentTotal === 1 ? "" : "s"}, so it cannot be deleted. Mark it done instead.` : "A campaign can be deleted until it has sent a message."}</p>
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>
        <Card className="lg:col-span-2 min-w-0 self-start">
          <CardHeader title="Enrollments" description={`${enrollments.length} lead${enrollments.length === 1 ? "" : "s"}. Deliveries: ${sent.map((s) => `${s.n} ${s.status}`).join(", ") || "none yet"}`} />
          <CardBody className="p-0">
            {enrollments.length === 0 ? <p className="p-4 text-[13px] text-fg-3">No leads enrolled. Use Enroll matching leads, or enroll from a lead's Messages tab.</p> : (
              <div className="overflow-x-auto">
                <Table>
                  <THead><tr><TH>Lead</TH><TH>Contact</TH><TH>Status</TH><TH right>Steps sent</TH><TH>Next send</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
                  <TBody>{enrollments.map((e) => (
                    <TR key={e.e.id}>
                      <TD><Link href={`/leads/${e.leadId}`} className="hover:underline">{e.address}, {e.city}</Link></TD>
                      <TD>{fullName({ firstName: e.first, lastName: e.last })}</TD>
                      <TD><Badge tone={e.e.status === "active" ? "good" : e.e.status === "replied" ? "info" : e.e.status === "opted_out" ? "bad" : "neutral"}>{e.e.status.replace("_", " ")}</Badge></TD>
                      <TD right>{Math.min(e.e.currentStep, steps.length)} of {steps.length}</TD>
                      <TD className="text-fg-3 whitespace-nowrap">{e.e.nextSendAt ? dateTime(e.e.nextSendAt) : ""}</TD>
                      <TD>
                        {writable && e.e.status === "active" ? <ActionButton action={stopEnrollment.bind(null, e.e.id, id)} variant="ghost" size="sm" confirm="Stop sending this campaign to this lead?">Stop</ActionButton> : null}
                        {writable && e.e.status === "stopped" ? <ActionButton action={resumeEnrollment.bind(null, e.e.id, id)} variant="ghost" size="sm">Resume</ActionButton> : null}
                      </TD>
                    </TR>
                  ))}</TBody>
                </Table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
