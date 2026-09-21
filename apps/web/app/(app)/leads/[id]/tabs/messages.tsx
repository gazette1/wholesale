import type { LeadDetail } from "@/lib/data/leads";
import { enrollInCampaign, stopLeadEnrollments } from "@/lib/actions/leads";
import { ActionButton } from "@/components/ui/action-form";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { dateTime, cn, fullName } from "@/lib/utils";
import { Composer } from "./composer";

export function MessagesTab({ detail, templates, campaigns, canSend }: { detail: LeadDetail; templates: { id: string; channel: string; name: string; subject: string | null; body: string }[]; campaigns: { id: string; name: string; status: string; channel: string }[]; canSend: boolean }) {
  const contacts = detail.contacts.map((c) => ({ id: c.contact.id, name: fullName(c.contact), phone: c.contact.phones[0]?.number ?? null, email: c.contact.emails[0]?.address ?? null, smsConsent: c.contact.smsConsent, dnc: c.contact.doNotContact }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader title="Conversation" description="Texts and emails with this seller, newest at the bottom" />
          <CardBody className="space-y-3 max-h-[60vh] overflow-y-auto scrollbar-thin">
            {detail.messages.length === 0 ? <p className="text-[13px] text-fg-3">No messages yet. Send the first touch below.</p> : null}
            {detail.messages.map((m) => {
              const cls = (m.payload as any)?.classification;
              return (
                <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[78%] rounded-lg px-3 py-2 text-[13px]", m.direction === "out" ? "bg-accent text-accent-fg" : "bg-surface-2 border border-border")}>
                    {m.subject ? <div className="font-medium mb-0.5">{m.subject}</div> : null}
                    <div className="whitespace-pre-wrap">{m.body}</div>
                    <div className={cn("mt-1 text-[11px] flex items-center gap-2", m.direction === "out" ? "text-white/70" : "text-fg-3")}>
                      <span>{m.channel.toUpperCase()} · {dateTime(m.createdAt)} · {m.status}</span>
                      {m.error ? <span className="text-bad">{m.error}</span> : null}
                      {cls ? <Badge tone={cls.action === "auto" ? "good" : "info"}>{String(cls.intent).replace(/_/g, " ")} {Math.round(cls.confidence * 100)}%</Badge> : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Send" />
          <CardBody>
            {canSend ? <Composer leadId={detail.lead.id} contacts={contacts} templates={templates} /> : <p className="text-xs text-fg-3">Your role cannot send messages.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sequences" description="Automated follow up campaigns" />
          <CardBody className="space-y-2">
            {detail.enrollments.map((e) => (
              <div key={e.e.id} className="flex items-center justify-between text-[13px]">
                <span>{e.name}</span>
                <Badge tone={e.e.status === "active" ? "good" : e.e.status === "opted_out" ? "bad" : "neutral"}>{e.e.status.replace(/_/g, " ")} · step {e.e.currentStep + 1}</Badge>
              </div>
            ))}
            {canSend ? campaigns.filter((c) => c.status === "active" && !detail.enrollments.some((e) => e.e.campaignId === c.id && e.e.status === "active")).map((c) => (
              <ActionButton key={c.id} action={enrollInCampaign.bind(null, detail.lead.id, c.id)} size="sm">Enroll in {c.name}</ActionButton>
            )) : null}
            {canSend && detail.enrollments.some((e) => e.e.status === "active") ? <ActionButton action={stopLeadEnrollments.bind(null, detail.lead.id)} size="sm" variant="ghost" className="text-bad" confirm="Stop every active sequence for this lead?">Stop active sequences</ActionButton> : null}
            {detail.enrollments.length === 0 && campaigns.filter((c) => c.status === "active").length === 0 ? <p className="text-xs text-fg-3">No active campaigns. Create one under Campaigns.</p> : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
