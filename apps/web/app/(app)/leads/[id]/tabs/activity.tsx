import type { LeadDetail } from "@/lib/data/leads";
import { addActivity } from "@/lib/actions/leads";
import { ActionForm } from "@/components/ui/action-form";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Textarea, Select, Input, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { dateTime, money } from "@/lib/utils";
import { Phone, MessageSquare, Mail, StickyNote, ArrowRightLeft, DollarSign, CheckSquare, Sparkles, FileText, Calculator, Bot } from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { call: Phone, sms: MessageSquare, email: Mail, note: StickyNote, stage_change: ArrowRightLeft, offer: DollarSign, task: CheckSquare, enrichment: Sparkles, document: FileText, analysis: Calculator, system: Bot };

export function ActivityTab({ detail, team, sessionProfileId }: { detail: LeadDetail; team: { id: string; name: string }[]; sessionProfileId: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader title="Timeline" description="Calls, messages, notes, stage changes, offers, and system events" />
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {detail.activities.map(({ a, actor }) => {
                const Icon = ICONS[a.type] ?? Bot;
                const p = a.payload as Record<string, any>;
                return (
                  <li key={a.id} className="flex gap-3 px-4 py-3">
                    <div className="h-7 w-7 rounded-full bg-surface-2 border border-border flex items-center justify-center shrink-0"><Icon className="h-3.5 w-3.5 text-fg-3" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium capitalize">{describe(a.type, p)}</span>
                        {p.direction ? <Badge tone={p.direction === "in" ? "good" : "neutral"}>{p.direction === "in" ? "Inbound" : "Outbound"}</Badge> : null}
                        {p.intent ? <Badge tone={p.action === "auto" ? "good" : "info"}>{String(p.intent).replace(/_/g, " ")} {p.confidence != null ? `${Math.round(p.confidence * 100)}%` : ""}</Badge> : null}
                        {p.outcome ? <Badge tone="neutral">{p.outcome}</Badge> : null}
                        <span className="text-xs text-fg-3 ml-auto">{actor ?? (a.type === "system" || p.direction === "in" ? "System" : "")} · {dateTime(a.occurredAt)}</span>
                      </div>
                      {p.text || p.body ? <p className="text-[13px] text-fg-2 mt-1 whitespace-pre-wrap">{p.text ?? p.body}</p> : null}
                      {p.amountMentioned ? <p className="text-xs text-fg-3 mt-1">Amount mentioned: {money(p.amountMentioned)}</p> : null}
                    </div>
                  </li>
                );
              })}
              {detail.activities.length === 0 ? <li className="px-4 py-6 text-[13px] text-fg-3">Nothing logged yet.</li> : null}
            </ul>
          </CardBody>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Log a call" />
          <CardBody>
            <ActionForm action={addActivity.bind(null, detail.lead.id)} submitLabel="Log call" resetOnSuccess className="space-y-2">
              <input type="hidden" name="type" value="call" />
              <Field label="Outcome"><Select name="outcome" defaultValue="no_answer"><option value="spoke">Spoke with seller</option><option value="voicemail">Left voicemail</option><option value="no_answer">No answer</option><option value="wrong_number">Wrong number</option><option value="callback">Asked for callback</option></Select></Field>
              <Field label="Notes"><Textarea name="text" placeholder="What they said, what they want, what is wrong with the house" /></Field>
              <Field label="Next follow up"><Input name="nextFollowUpAt" type="datetime-local" /></Field>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Add a note" description="Deal issue suggestions are drawn from notes." />
          <CardBody>
            <ActionForm action={addActivity.bind(null, detail.lead.id)} submitLabel="Add note" variant="outline" resetOnSuccess>
              <input type="hidden" name="type" value="note" />
              <Textarea name="text" placeholder="Note" required />
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function describe(type: string, p: Record<string, any>): string {
  switch (type) {
    case "stage_change": return `Moved to ${p.toName ?? p.to}`;
    case "offer": return p.status ? `Offer ${p.status}${p.amount ? ` ${money(p.amount)}` : ""}` : "Offer";
    case "enrichment": return `Property report ${p.status} (${p.provider})`;
    case "call": return "Call";
    case "sms": return "Text message";
    case "email": return "Email";
    case "analysis": return p.text ?? "Analysis";
    default: return type.replace(/_/g, " ");
  }
}
