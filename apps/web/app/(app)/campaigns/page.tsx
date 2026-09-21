import Link from "next/link";
import { requireSession, can } from "@/lib/auth";
import { listCampaigns } from "@/lib/data/campaigns";
import { listStages } from "@/lib/data/leads";
import { createCampaign, runDispatchNow } from "@/lib/actions/campaigns";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { relative } from "@/lib/utils";
import { Send } from "lucide-react";
import { SegmentFields } from "./segment-fields";

export const metadata = { title: "Campaigns" };
const TONE: Record<string, "neutral" | "good" | "warn" | "info"> = { draft: "neutral", active: "good", paused: "warn", done: "info" };

export default async function CampaignsPage() {
  const session = await requireSession();
  const [rows, stages] = await Promise.all([listCampaigns(session.orgId), listStages(session.orgId)]);
  const writable = can(session, "campaign:write");
  const stageNames = (keys?: string[]) => (keys ?? []).map((k) => stages.find((st) => st.key === k)?.name ?? k).join(", ") || "any";
  return (
    <>
      <PageHeader title="Campaigns" description="Automated text and email sequences. Each step waits its delay after the previous send. Replies stop the sequence." actions={writable ? <ActionButton action={runDispatchNow} variant="outline" size="md">Send due steps now</ActionButton> : null} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 min-w-0">
          {rows.length === 0 ? <EmptyState icon={Send} title="No campaigns" description="Create a sequence and enroll a segment of leads." /> : (
            <div className="rounded-lg border border-border bg-surface overflow-hidden">
              <Table>
                <THead><tr><TH>Campaign</TH><TH>Channel</TH><TH>Status</TH><TH right>Enrolled</TH><TH right>Active</TH><TH right>Replied</TH><TH>Created</TH></tr></THead>
                <TBody>{rows.map((c) => (
                  <TR key={c.id}>
                    <TD><Link href={`/campaigns/${c.id}`} className="font-medium hover:underline break-words">{c.name}</Link><div className="text-xs text-fg-3">Stages: {stageNames((c.segment as { stageKeys?: string[] } | null)?.stageKeys)}</div></TD>
                    <TD className="uppercase text-xs">{c.channel}</TD><TD><Badge tone={TONE[c.status]}>{c.status}</Badge></TD>
                    <TD right>{c.enrolled}</TD><TD right>{c.active}</TD><TD right>{c.replied}</TD><TD className="text-fg-3 whitespace-nowrap">{relative(c.createdAt)}</TD>
                  </TR>
                ))}</TBody>
              </Table>
            </div>
          )}
        </div>
        {writable ? (
          <Card className="min-w-0 self-start">
            <CardHeader title="New campaign" />
            <CardBody>
              <ActionForm action={createCampaign} submitLabel="Create" className="space-y-2">
                <Field label="Name"><Input name="name" required maxLength={120} placeholder="New lead 5 day follow up" /></Field>
                <Field label="Channel"><Select name="channel" defaultValue="sms"><option value="sms">Text</option><option value="email">Email</option></Select></Field>
                <SegmentFields stages={stages} selected={["new_lead", "attempted_contact"].filter((k) => stages.some((st) => st.key === k))} />
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
