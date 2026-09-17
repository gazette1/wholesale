import Link from "next/link";
import { requireSession, can } from "@/lib/auth";
import { listCampaigns } from "@/lib/data/campaigns";
import { listStages } from "@/lib/data/leads";
import { createCampaign, runDispatchNow } from "@/lib/actions/campaigns";
import { ActionButton } from "@/components/ui/action-form";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { relative } from "@/lib/utils";
import { Send } from "lucide-react";

export const metadata = { title: "Campaigns" };
const TONE: Record<string, "neutral" | "good" | "warn" | "info"> = { draft: "neutral", active: "good", paused: "warn", done: "info" };

export default async function CampaignsPage() {
  const session = await requireSession();
  const [rows, stages] = await Promise.all([listCampaigns(session.orgId), listStages(session.orgId)]);
  const writable = can(session, "campaign:write");
  return (
    <>
      <PageHeader title="Campaigns" description="Automated text and email sequences. Each step waits its delay after the previous send. Replies stop the sequence." actions={writable ? <ActionButton action={runDispatchNow} variant="outline" size="md">Send due steps now</ActionButton> : null} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {rows.length === 0 ? <EmptyState icon={Send} title="No campaigns" description="Create a sequence and enroll a segment of leads." /> : (
            <div className="rounded-lg border border-border bg-surface overflow-hidden">
              <Table>
                <THead><tr><TH>Campaign</TH><TH>Channel</TH><TH>Status</TH><TH right>Enrolled</TH><TH right>Active</TH><TH right>Replied</TH><TH>Created</TH></tr></THead>
                <TBody>{rows.map((c) => (
                  <TR key={c.id}>
                    <TD><Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link><div className="text-xs text-fg-3">Stages: {((c.segment as any)?.stageKeys ?? []).join(", ") || "any"}</div></TD>
                    <TD className="uppercase text-xs">{c.channel}</TD><TD><Badge tone={TONE[c.status]}>{c.status}</Badge></TD>
                    <TD right>{c.enrolled}</TD><TD right>{c.active}</TD><TD right>{c.replied}</TD><TD className="text-fg-3">{relative(c.createdAt)}</TD>
                  </TR>
                ))}</TBody>
              </Table>
            </div>
          )}
        </div>
        {writable ? (
          <Card>
            <CardHeader title="New campaign" />
            <CardBody>
              <form action={createCampaign} className="space-y-2">
                <Field label="Name"><Input name="name" required placeholder="New lead 5 day follow up" /></Field>
                <Field label="Channel"><Select name="channel" defaultValue="sms"><option value="sms">Text</option><option value="email">Email</option></Select></Field>
                <Field label="Segment: stages (comma separated keys)" hint={stages.map((s) => s.key).join(", ")}><Input name="stageKeys" defaultValue="new_lead,attempted_contact" /></Field>
                <Field label="Only leads with at most this many attempts"><Input name="maxAttempts" type="number" placeholder="any" /></Field>
                <Button type="submit" variant="primary">Create</Button>
              </form>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
