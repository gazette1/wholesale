"use client";
import * as React from "react";
import { APP_ROLES, type FormSettings } from "@dealcalc/forms";
import { Link2 } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { createFormPublicLink, updateFormDetailsAction } from "@/lib/actions/forms";
import { ROLE_LABELS } from "./model";
import type { ProfileOption } from "./roles-tab";

export type DetailsValue = { name: string; category: string | null; description: string | null; ownerId: string | null; settings: FormSettings };

export function SettingsTab({ formId, details, profiles, published, onSaved }: {
  formId: string; details: DetailsValue; profiles: ProfileOption[]; published: boolean; onSaved: (d: DetailsValue) => void;
}) {
  const [savedAllow, setSavedAllow] = React.useState(details.settings.allowPublicLink);
  const [link, setLink] = React.useState<{ url?: string; error?: string; pending?: boolean }>({});
  const who = new Set(details.settings.whoMayStart);

  const action = async (fd: FormData) => {
    const settings: FormSettings = {
      ...details.settings,
      subjectType: String(fd.get("subjectType")) as FormSettings["subjectType"],
      whoMayStart: fd.getAll("whoMayStart").map(String) as FormSettings["whoMayStart"],
      allowPublicLink: fd.get("allowPublicLink") === "on",
      commentsEnabled: fd.get("commentsEnabled") === "on",
    };
    const next: DetailsValue = {
      name: String(fd.get("name") ?? "").trim(), category: String(fd.get("category") ?? "").trim() || null,
      description: String(fd.get("description") ?? "").trim() || null, ownerId: String(fd.get("ownerId") ?? "") || null, settings,
    };
    const res = await updateFormDetailsAction(formId, next);
    if (res.ok) { setSavedAllow(settings.allowPublicLink); onSaved(next); }
    return res;
  };

  return (
    <div className="space-y-5" aria-label="Settings">
      <ActionForm action={action} submitLabel="Save settings" className="space-y-3 max-w-xl">
        <Field label="Form name"><Input name="name" defaultValue={details.name} required maxLength={200} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><Input name="category" defaultValue={details.category ?? ""} maxLength={80} /></Field>
          <Field label="Form owner">
            <Select name="ownerId" defaultValue={details.ownerId ?? ""}>
              <option value="">No owner</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Description"><Textarea name="description" defaultValue={details.description ?? ""} /></Field>
        <Field label="Subject type" hint="What each submission is about. It cannot change after a submission starts.">
          <Select name="subjectType" defaultValue={details.settings.subjectType}>
            <option value="lead">Lead</option><option value="buyer">Buyer</option><option value="none">None (started from the library)</option>
          </Select>
        </Field>
        <fieldset className="rounded-md border border-border p-2.5 space-y-1.5">
          <legend className="px-1 text-xs font-medium text-fg-2">Who may start this form</legend>
          <p className="text-xs text-fg-3">Leave all unchecked to allow every role except viewers.</p>
          {APP_ROLES.map((r) => (
            <label key={r} className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="whoMayStart" value={r} defaultChecked={who.has(r)} />{ROLE_LABELS[r]}</label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="allowPublicLink" defaultChecked={details.settings.allowPublicLink} />Allow a public link that starts a new submission</label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="commentsEnabled" defaultChecked={details.settings.commentsEnabled} />Comments on</label>
      </ActionForm>

      <div className="max-w-xl space-y-2 rounded-lg border border-border p-3">
        <h3 className="text-[13px] font-semibold">Public link</h3>
        <p className="text-xs text-fg-3">Anyone with the link can start a submission after a one-time code. The address is shown once, so copy it when it appears.</p>
        {!savedAllow ? <p className="text-xs text-fg-3">Turn on the public link above and save the settings first.</p> : null}
        {!published ? <p className="text-xs text-fg-3">Publish the form before creating a public link.</p> : null}
        <Button type="button" variant="outline" size="sm" disabled={!savedAllow || !published} loading={link.pending} onClick={async () => {
          setLink({ pending: true });
          const res = await createFormPublicLink(formId);
          if (res.ok && res.url) setLink({ url: res.url.startsWith("/") ? `${window.location.origin}${res.url}` : res.url });
          else setLink({ error: res.ok ? "No link was returned." : res.error });
        }}><Link2 className="h-3.5 w-3.5" />Create public link</Button>
        {link.url ? (
          <div className="space-y-1">
            <Field label="Public link address"><Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} /></Field>
            <Alert tone="warn">Copy this address now. It will not be shown again.</Alert>
          </div>
        ) : null}
        {link.error ? <Alert tone="bad">{link.error}</Alert> : null}
      </div>
    </div>
  );
}
