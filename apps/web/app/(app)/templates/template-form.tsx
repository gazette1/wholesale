"use client";
import { useState } from "react";
import type { ActionResult } from "@/lib/actions/leads";
import { ActionForm } from "@/components/ui/action-form";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { MERGE_FIELD_HELP, SMS_MAX_CHARS, EMAIL_MAX_CHARS, SUBJECT_MAX_CHARS, TEMPLATE_NAME_MAX_CHARS, smsCountLabel, smsSegments, unknownMergeFields } from "@/lib/template-fields";

type Channel = "sms" | "email";
type Existing = { name: string; channel: Channel; subject: string | null; body: string; active: boolean };

/**
 * Create and edit form for a message template. It is a client component so the Subject field
 * appears as soon as Channel is Email, and so the character count follows the typing.
 */
export function TemplateForm({ action, template }: { action: (form: FormData) => Promise<ActionResult>; template?: Existing }) {
  const [channel, setChannel] = useState<Channel>(template?.channel ?? "sms");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const creating = !template;
  const limit = channel === "sms" ? SMS_MAX_CHARS : EMAIL_MAX_CHARS;
  const unknown = unknownMergeFields(`${channel === "email" ? subject : ""}\n${body}`);
  const over = body.trim().length > limit;
  const long = channel === "sms" && smsSegments(body.trim()).segments > 1;
  const countText = channel === "sms" ? smsCountLabel(body.trim()) : `${body.trim().length.toLocaleString("en-US")} character${body.trim().length === 1 ? "" : "s"}`;
  return (
    <ActionForm action={action} submitLabel={creating ? "Create" : "Save"} variant={creating ? "primary" : "outline"} size={creating ? "md" : "sm"} resetOnSuccess={creating} className="space-y-2"
      onSuccess={creating ? () => { setChannel("sms"); setSubject(""); setBody(""); } : undefined}>
      <div className={creating ? "space-y-2" : "grid grid-cols-1 sm:grid-cols-4 gap-2"}>
        <Field label="Name" className={creating ? undefined : "sm:col-span-2"}><Input name="name" defaultValue={template?.name ?? ""} required maxLength={TEMPLATE_NAME_MAX_CHARS} /></Field>
        <Field label="Channel"><Select name="channel" value={channel} onChange={(e) => setChannel(e.target.value === "email" ? "email" : "sms")}><option value="sms">Text</option><option value="email">Email</option></Select></Field>
        {template ? <Field label="Active"><Select name="active" defaultValue={template.active ? "on" : "off"}><option value="on">Yes</option><option value="off">No</option></Select></Field> : null}
      </div>
      {channel === "email" ? <Field label="Subject (required for email)"><Input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={SUBJECT_MAX_CHARS} /></Field> : null}
      <Field label="Body"><Textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} required placeholder={creating ? "Hi {{first_name}}, this is {{sender_name}}..." : undefined} className={creating ? "min-h-[120px]" : "min-h-[90px]"} /></Field>
      <div className="text-xs space-y-1">
        <p aria-live="polite" className={over ? "text-bad" : long ? "text-warn" : "text-fg-3"}>
          {countText}{over ? `. The limit is ${limit.toLocaleString("en-US")}.` : ""}{!over && long ? ". Each segment is billed as one text." : ""}
        </p>
        {channel === "sms" ? <p className="text-fg-3">One segment holds 160 characters. Longer texts split into segments of 153. Merge fields change the final length.</p> : null}
        {unknown.length ? <p role="alert" className="text-bad break-words">Unknown merge field: {unknown.map((f) => `{{${f}}}`).join(", ")}. It would send as a blank.</p> : null}
        <p className="text-fg-3 break-words">Merge fields: {MERGE_FIELD_HELP}</p>
      </div>
    </ActionForm>
  );
}
