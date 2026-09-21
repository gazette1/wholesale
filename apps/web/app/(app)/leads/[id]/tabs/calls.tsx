import type { LeadDetail } from "@/lib/data/leads";
import type { LeadCall } from "@/lib/data/calls";
import { providerStatus } from "@dealcalc/integrations";
import { startLeadCall, saveCallOutcome } from "@/lib/actions/calls";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/misc";
import { Input, Select } from "@/components/ui/input";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { dateTime, fullName } from "@/lib/utils";
import { Phone } from "lucide-react";

const TONE: Record<string, BadgeTone> = { queued: "neutral", ringing: "info", in_progress: "info", completed: "good", busy: "warn", no_answer: "warn", failed: "bad", canceled: "neutral" };
const OUTCOMES: [string, string][] = [["spoke", "Spoke with seller"], ["voicemail", "Left voicemail"], ["no_answer", "No answer"], ["wrong_number", "Wrong number"], ["callback", "Asked for callback"]];

function duration(seconds: number | null): string {
  if (seconds == null) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CallsTab({ detail, calls, canCall }: { detail: LeadDetail; calls: LeadCall[]; canCall: boolean }) {
  const contact = detail.primaryContact;
  const phone = contact?.phones.find((p) => p.isPrimary)?.number ?? contact?.phones[0]?.number;
  const status = providerStatus();
  const blocked = !contact ? "This lead has no primary contact." : contact.doNotContact ? "This contact is marked do not contact. Calling is blocked." : !phone ? "The primary contact has no phone number." : !canCall ? "Your role cannot place calls." : null;
  return (
    <div className="space-y-4">
      {status.voice === "mock" ? <Alert tone="warn">Voice calling is not connected yet. The Call button logs a mock call and no phone rings. Setup steps are in docs/INTEGRATIONS.md under Connecting voice.</Alert> : null}
      <Card>
        <CardHeader title={contact ? `Call ${fullName(contact) || "the contact"}` : "Call"} description={blocked ? undefined : (status.voice === "mock" ? `${phone}. Mock provider.` : `${phone}. Your phone rings first. When you answer, the seller is dialed from your Twilio number.`)} />
        <CardBody>
          {/* TODO(phase2): add the @twilio/voice-sdk dependency, fetch GET /api/voice/token, and replace this button with a client softphone that calls device.connect({ params: { To } }). POST /api/webhooks/twilio/voice already answers that call. Until then the button places a bridge call. */}
          {blocked ? <p className="text-xs text-fg-3">{blocked}</p> : <ActionButton action={startLeadCall.bind(null, detail.lead.id)} variant="primary" size="md"><Phone className="h-4 w-4" />Call {phone}</ActionButton>}
        </CardBody>
      </Card>
      {calls.length === 0 ? <EmptyState icon={Phone} title="No calls yet" description="Calls placed from this page are logged here with their status, length, and outcome." /> : (
        <Card>
          <CardHeader title="Call log" description="Set an outcome after each call. It also shows on the Activity tab." />
          <CardBody className="p-0 overflow-x-auto">
            <Table>
              <THead><tr><TH>Direction</TH><TH>Number</TH><TH>Status</TH><TH right>Length</TH><TH>Who</TH><TH>When</TH><TH>Outcome and notes</TH></tr></THead>
              <TBody>
                {calls.map(({ call: c, placedByName }) => (
                  <TR key={c.id}>
                    <TD><Badge tone={c.direction === "in" ? "good" : "neutral"}>{c.direction === "in" ? "Inbound" : "Outbound"}</Badge></TD>
                    <TD className="whitespace-nowrap">{c.direction === "in" ? c.fromAddr : c.toAddr}</TD>
                    <TD><Badge tone={TONE[c.status] ?? "neutral"}>{c.status.replace(/_/g, " ")}</Badge>{c.provider === "mock" ? <span className="ml-1 text-xs text-fg-3">mock</span> : null}</TD>
                    <TD right className="text-fg-3">{duration(c.durationSeconds)}</TD>
                    <TD className="text-fg-3 whitespace-nowrap">{placedByName ?? ""}</TD>
                    <TD className="text-fg-3 whitespace-nowrap">{dateTime(c.startedAt ?? c.createdAt)}</TD>
                    <TD>
                      {canCall ? (
                        <ActionForm action={saveCallOutcome.bind(null, c.id, detail.lead.id)} submitLabel="Save" variant="outline" size="sm" inline className="flex flex-wrap items-center gap-2">
                          <Select name="outcome" defaultValue={c.outcome ?? ""} aria-label="Call outcome" className="h-7 w-40 text-xs"><option value="">No outcome</option>{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                          <Input name="notes" defaultValue={c.notes ?? ""} maxLength={4000} placeholder="Notes" aria-label="Call notes" className="h-7 w-56 text-xs" />
                        </ActionForm>
                      ) : <span className="text-fg-3">{[OUTCOMES.find(([v]) => v === c.outcome)?.[1], c.notes].filter(Boolean).join(". ")}</span>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
