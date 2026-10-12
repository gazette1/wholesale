"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useServerForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { createFormAction } from "@/lib/actions/forms";

export function NewFormPanel({ forms, templates }: { forms: { id: string; name: string }[]; templates: { slug: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { state, pending, onSubmit } = useServerForm(async (fd) => {
    const start = String(fd.get("start") ?? "blank");
    const from = start.startsWith("copy:") ? { kind: "copy" as const, formId: start.slice(5) }
      : start.startsWith("template:") ? { kind: "template" as const, slug: start.slice(9) } : { kind: "blank" as const };
    return createFormAction({ name: String(fd.get("name") ?? ""), category: String(fd.get("category") ?? "") || null, from });
  }, { onSuccess: (res) => { if (res.id) router.push(`/forms/${res.id}`); } });

  if (!open) return <Button type="button" variant="primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New form</Button>;
  return (
    <form onSubmit={onSubmit} aria-label="New form" className="w-full rounded-lg border border-border bg-surface p-4 space-y-3 basis-full">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Form name"><Input name="name" required maxLength={200} autoFocus /></Field>
        <Field label="Category"><Input name="category" maxLength={80} placeholder="For example Acquisitions" /></Field>
        <Field label="Start from">
          <Select name="start" defaultValue="blank">
            <option value="blank">A blank form</option>
            {templates.length ? <optgroup label="Templates">{templates.map((t) => <option key={t.slug} value={`template:${t.slug}`}>{t.name}</option>)}</optgroup> : null}
            {forms.length ? <optgroup label="Copy an existing form">{forms.map((f) => <option key={f.id} value={`copy:${f.id}`}>{f.name}</option>)}</optgroup> : null}
          </Select>
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" loading={pending}>Create form</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {state && !state.ok && !pending ? <Alert tone="bad">{state.error}</Alert> : null}
    </form>
  );
}
