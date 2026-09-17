"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { sendMessage } from "@/lib/actions/leads";
import { ActionForm } from "@/components/ui/action-form";
import { Select, Textarea, Input, Field } from "@/components/ui/input";

export function Composer({ leadId, contacts, templates }: { leadId: string; contacts: { id: string; name: string; phone: string | null; email: string | null; smsConsent: string; dnc: boolean }[]; templates: { id: string; channel: string; name: string; subject: string | null; body: string }[] }) {
  const params = useSearchParams();
  const [channel, setChannel] = useState<"sms" | "email">(params.get("channel") === "email" ? "email" : "sms");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [templateId, setTemplateId] = useState("");
  const usable = templates.filter((t) => t.channel === channel);
  const first = contacts[0];
  return (
    <ActionForm action={sendMessage.bind(null, leadId)} submitLabel={channel === "sms" ? "Send text" : "Send email"} resetOnSuccess onSuccess={() => { setBody(""); setSubject(""); setTemplateId(""); }} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Channel"><Select name="channel" value={channel} onChange={(e) => { setChannel(e.target.value as any); setTemplateId(""); }}><option value="sms">Text</option><option value="email">Email</option></Select></Field>
        <Field label="To"><Select name="contactId" defaultValue={first?.id}>{contacts.map((c) => <option key={c.id} value={c.id} disabled={c.dnc || (channel === "sms" ? c.smsConsent === "opted_out" || !c.phone : !c.email)}>{c.name} {channel === "sms" ? c.phone ?? "(no phone)" : c.email ?? "(no email)"}</option>)}</Select></Field>
      </div>
      <Field label="Template"><Select name="templateId" value={templateId} onChange={(e) => { const t = usable.find((x) => x.id === e.target.value); setTemplateId(e.target.value); if (t) { setBody(t.body); setSubject(t.subject ?? ""); } }}><option value="">Write from scratch</option>{usable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
      {channel === "email" ? <Field label="Subject"><Input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required /></Field> : null}
      <Field label="Message" hint="Merge fields: {{first_name}}, {{property_address}}, {{sender_name}}"><Textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} required placeholder="Hi {{first_name}}, this is {{sender_name}} about {{property_address}}..." className="min-h-[110px]" /></Field>
      {channel === "sms" ? <p className="text-[11px] text-fg-3">{body.length} characters{body.length > 160 ? `, ${Math.ceil(body.length / 153)} segments` : ""}. Opt out keywords are handled automatically.</p> : null}
    </ActionForm>
  );
}
