"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { sendMessage } from "@/lib/actions/leads";
import { ActionForm } from "@/components/ui/action-form";
import { Select, Textarea, Input, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";

type ComposerContact = { id: string; name: string; phone: string | null; email: string | null; smsConsent: string; dnc: boolean };

function blockedReason(c: ComposerContact, channel: "sms" | "email"): string | null {
  if (c.dnc) return "marked do not contact";
  if (channel === "sms") return c.smsConsent === "opted_out" ? "opted out of SMS" : !c.phone ? "no phone number" : null;
  return !c.email ? "no email address" : null;
}

export function Composer({ leadId, contacts, templates }: { leadId: string; contacts: ComposerContact[]; templates: { id: string; channel: string; name: string; subject: string | null; body: string }[] }) {
  const params = useSearchParams();
  const urlChannel = params.get("channel") === "email" ? "email" : "sms";
  const [channel, setChannel] = useState<"sms" | "email">(urlChannel);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [contactId, setContactId] = useState("");
  // The header's Text and Email buttons change the URL while this tab is already open.
  useEffect(() => { setChannel(urlChannel); setTemplateId(""); }, [urlChannel]);
  const usable = templates.filter((t) => t.channel === channel);
  const eligible = useMemo(() => contacts.filter((c) => !blockedReason(c, channel)), [contacts, channel]);
  // Keep the recipient valid as the channel or consent changes.
  useEffect(() => { if (!eligible.some((c) => c.id === contactId)) setContactId(eligible[0]?.id ?? ""); }, [eligible, contactId]);

  if (contacts.length === 0) return <Alert tone="warn">This lead has no contact yet. Add one on the Overview tab before sending.</Alert>;
  const noneEligible = eligible.length === 0;
  return (
    <ActionForm action={sendMessage.bind(null, leadId)} submitLabel={channel === "sms" ? "Send text" : "Send email"} onSuccess={() => { setBody(""); setSubject(""); setTemplateId(""); }} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Channel"><Select name="channel" value={channel} onChange={(e) => { setChannel(e.target.value === "email" ? "email" : "sms"); setTemplateId(""); }}><option value="sms">Text</option><option value="email">Email</option></Select></Field>
        <Field label="To">
          <Select name="contactId" value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={noneEligible}>
            {noneEligible ? <option value="">Nobody can receive this</option> : null}
            {contacts.map((c) => { const why = blockedReason(c, channel); return <option key={c.id} value={c.id} disabled={Boolean(why)}>{c.name} {why ? `(${why})` : channel === "sms" ? c.phone : c.email}</option>; })}
          </Select>
        </Field>
      </div>
      {noneEligible ? <Alert tone="bad">{channel === "sms" ? "Texting is blocked for this lead" : "Email is blocked for this lead"}. {contacts.map((c) => { const why = blockedReason(c, channel); return why === "opted out of SMS" ? `${c.name} opted out of SMS` : why === "marked do not contact" ? `${c.name} is marked do not contact` : `${c.name} has ${why}`; }).join(". ")}.</Alert> : null}
      <Field label="Template"><Select name="templateId" value={templateId} onChange={(e) => { const t = usable.find((x) => x.id === e.target.value); setTemplateId(e.target.value); if (t) { setBody(t.body); setSubject(t.subject ?? ""); } }}><option value="">Write from scratch</option>{usable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
      {channel === "email" ? <Field label="Subject"><Input name="subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} required /></Field> : null}
      <Field label="Message" hint="Merge fields: {{first_name}}, {{property_address}}, {{sender_name}}"><Textarea name="body" value={body} maxLength={channel === "sms" ? 1600 : 20000} onChange={(e) => setBody(e.target.value)} required placeholder="Hi {{first_name}}, this is {{sender_name}} about {{property_address}}..." className="min-h-[110px]" /></Field>
      {channel === "sms" ? <p className="text-[11px] text-fg-3">{body.length} characters{body.length > 160 ? `, ${Math.ceil(body.length / 153)} segments` : ""}. Opt out keywords are handled automatically.</p> : null}
    </ActionForm>
  );
}
