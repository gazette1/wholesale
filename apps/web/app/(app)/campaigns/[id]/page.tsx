import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { getCampaign, listTemplates } from "@/lib/data/campaigns";
import { addStep, removeStep, setCampaignStatus, enrollMatching, stopEnrollment } from "@/lib/actions/campaigns";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { dateTime, fullName } from "@/lib/utils";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const detail = await getCampaign(session.orgId, id);
  if (!detail) notFound();
  const templates = (await listTemplates(session.orgId)).filter((t) => t.channel === detail.campaign.channel && t.active);
  const writable = can(session, "campaign:write");
  const { campaign, steps, enrollments, sent } = detail;
  return (
    <>
      <PageHeader crumbs={[{ label: "Campaigns", href: "/campaigns" }, { label: campaign.name }]} title={<span className="flex items-center gap-2">{campaign.name}<Badge tone={campaign.status === "active" ? "good" : campaign.status === "paused" ? "warn" : "neutral"}>{campaign.status}</Badge></span>} description={`${campaign.channel.toUpperCase()} · segment stages: ${((campaign.segment as any)?.stageKeys ?? []).join(", ") || "any"}`}
        actions={writable ? <>
          {campaign.status !== "active" ? <ActionButton action={setCampaignStatus.bind(null, id, "active")} variant="primary" size="md">Activate</ActionButton> : <ActionButton action={setCampaignStatus.bind(null, id, "paused")} size="md">Pause</ActionButton>}
          <ActionButton action={enrollMatching.bind(null, id)} size="md">Enroll matching leads</ActionButton>
        </> : null} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Steps" description="Delay counts from the previous send" />
          <CardBody className="space-y-2">
            {steps.map(({ step, template }, i) => (
              <div key={step.id} className="rounded-md border border-border p-2.5">
                <div className="flex items-center justify-between"><span className="text-[13px] font-medium">Step {i + 1} · {template.name}</span><span className="text-xs text-fg-3">{i === 0 ? "immediately" : `after ${step.delayHours}h`}</span></div>
                <p className="text-xs text-fg-2 mt-1 line-clamp-3">{template.body}</p>
                {writable ? <div className="mt-1"><ActionButton action={removeStep.bind(null, id, step.id)} variant="ghost" size="sm">Remove</ActionButton></div> : null}
              </div>
            ))}
            {steps.length === 0 ? <p className="text-xs text-fg-3">No steps yet.</p> : null}
            {writable ? (
              <ActionForm action={addStep.bind(null, id)} submitLabel="Add step" variant="outline" size="sm" resetOnSuccess className="space-y-2 pt-2 border-t border-border">
                <Field label="Template"><Select name="templateId" defaultValue="">{templates.length === 0 ? <option value="">No templates for this channel</option> : null}{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
                <Field label="Delay hours"><Input name="delayHours" type="number" defaultValue={steps.length === 0 ? 0 : 24} /></Field>
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Enrollments" description={`${enrollments.length} leads · deliveries: ${sent.map((s) => `${s.n} ${s.status}`).join(", ") || "none yet"}`} />
          <CardBody className="p-0">
            {enrollments.length === 0 ? <p className="p-4 text-[13px] text-fg-3">No leads enrolled. Use Enroll matching leads, or enroll from a lead's Messages tab.</p> : (
              <Table>
                <THead><tr><TH>Lead</TH><TH>Contact</TH><TH>Status</TH><TH right>Step</TH><TH>Next send</TH><TH></TH></tr></THead>
                <TBody>{enrollments.map((e) => (
                  <TR key={e.e.id}>
                    <TD><Link href={`/leads/${e.leadId}`} className="hover:underline">{e.address}, {e.city}</Link></TD>
                    <TD>{fullName({ firstName: e.first, lastName: e.last })}</TD>
                    <TD><Badge tone={e.e.status === "active" ? "good" : e.e.status === "replied" ? "info" : e.e.status === "opted_out" ? "bad" : "neutral"}>{e.e.status}</Badge></TD>
                    <TD right>{e.e.currentStep}</TD>
                    <TD className="text-fg-3">{e.e.nextSendAt ? dateTime(e.e.nextSendAt) : ""}</TD>
                    <TD>{writable && e.e.status === "active" ? <ActionButton action={stopEnrollment.bind(null, e.e.id, id)} variant="ghost" size="sm">Stop</ActionButton> : null}</TD>
                  </TR>
                ))}</TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
