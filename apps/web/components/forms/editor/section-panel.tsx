"use client";
import * as React from "react";
import type { FormDefinition, SectionDef } from "@dealcalc/forms";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Check, DueRuleEditor, NumberField } from "./controls";

export function SectionPanel({ section, def, onChange, onDelete }: { section: SectionDef; def: FormDefinition; onChange: (patch: Partial<SectionDef>) => void; onDelete: () => void }) {
  const rule = section.completionRule;
  return (
    <div className="space-y-3" aria-label="Section settings">
      <h2 className="text-sm font-semibold">Section settings</h2>
      <Field label="Section title"><Input value={section.title} onChange={(e) => onChange({ title: e.target.value })} /></Field>
      <Field label="Section description"><Textarea value={section.description ?? ""} onChange={(e) => onChange({ description: e.target.value || undefined })} /></Field>
      <Field label="Owner role" hint="The role that works this section. Roles are defined on the Roles tab.">
        <Select value={section.ownerRole} onChange={(e) => onChange({ ownerRole: e.target.value })}>
          {def.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          {!def.roles.some((r) => r.key === section.ownerRole) ? <option value={section.ownerRole}>{section.ownerRole} (missing)</option> : null}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Completion rule">
          <Select value={rule.type} onChange={(e) => {
            const type = e.target.value as "any" | "all" | "minimum";
            onChange({ completionRule: type === "minimum" ? { type, count: rule.count ?? 2 } : { type } });
          }}>
            <option value="any">Any one assignee</option><option value="all">All assignees</option><option value="minimum">Minimum number</option>
          </Select>
        </Field>
        {rule.type === "minimum" ? <NumberField label="Minimum assignees" min={1} step={1} value={rule.count} onChange={(v) => onChange({ completionRule: { type: "minimum", count: v === undefined ? undefined : Math.max(1, Math.trunc(v)) } })} /> : null}
      </div>
      <DueRuleEditor rule={section.dueRule} onChange={(r) => onChange({ dueRule: r })} def={def} label="Section due date" />
      <div className="space-y-2">
        <Check label="Needs approval" hint="The section ends with approve, reject, or send back." checked={section.needsApproval} onChange={(v) => onChange({ needsApproval: v })} />
        <Check label="Skippable" hint="A rule may skip this section." checked={section.skippable} onChange={(v) => onChange({ skippable: v })} />
        <Check label="Stop point" hint="Later sections wait until this one is done." checked={section.stopPoint} onChange={(v) => onChange({ stopPoint: v })} />
        <Check label="Allow external people" hint="This section can be shared through an invite link." checked={section.allowExternal} onChange={(v) => onChange({ allowExternal: v })} />
      </div>
      <Field label="Parallel group" hint="Adjacent sections with the same group name open together."><Input value={section.parallelGroup ?? ""} onChange={(e) => onChange({ parallelGroup: e.target.value.trim() ? e.target.value : undefined })} placeholder="Leave empty to run in order" /></Field>
      <p className="text-xs text-fg-3">Section key: <code>{section.key}</code></p>
      <Button type="button" variant="danger" size="sm" onClick={() => { if (window.confirm(`Delete the section "${section.title}" and its ${section.fields.length} fields from the draft?`)) onDelete(); }}><Trash2 className="h-3.5 w-3.5" />Delete section</Button>
    </div>
  );
}
