"use client";
import * as React from "react";
import { APP_ROLES, evaluate, orderedSections, sortByOrder, type Answers, type AppRole, type Evaluation, type FieldDef, type FormDefinition } from "@dealcalc/forms";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ROLE_LABELS } from "./model";

function PreviewInput({ field, value, locked, onChange }: { field: FieldDef; value: unknown; locked: boolean; onChange: (v: unknown) => void }) {
  const o = field.options;
  const label = field.label;
  const disabled = locked || field.readOnly;
  switch (field.type) {
    case "content":
      return <p className="text-[13px] text-fg-2 whitespace-pre-wrap">{o.body ?? field.label}</p>;
    case "short_text":
      return <Field label={label}><Input disabled={disabled} value={typeof value === "string" ? value : ""} placeholder={o.placeholder} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "long_text":
      return <Field label={label}><Textarea disabled={disabled} value={typeof value === "string" ? value : ""} placeholder={o.placeholder} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "number":
      return <Field label={label}><Input type="number" disabled={disabled} value={typeof value === "number" ? value : typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} /></Field>;
    case "date":
      return <Field label={label}><Input type={o.withTime ? "datetime-local" : "date"} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} /></Field>;
    case "yes_no":
      return (
        <Field label={label}>
          <Select disabled={disabled} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "yes" ? true : e.target.value === "no" ? false : undefined)}>
            <option value="">Choose</option><option value="yes">{o.yesLabel || "Yes"}</option><option value="no">{o.noLabel || "No"}</option>
          </Select>
        </Field>
      );
    case "single_choice":
      return (
        <Field label={label}>
          <Select disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">Choose</option>{(o.choices ?? []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
      );
    case "multiple_choice": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset>
          <legend className="text-xs font-medium text-fg-2 mb-1">{label}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {(o.choices ?? []).map((c) => (
              <label key={c.value} className="flex items-center gap-1.5 text-[13px]">
                <input type="checkbox" disabled={disabled} checked={list.includes(c.value)} onChange={(e) => onChange(e.target.checked ? [...list, c.value] : list.filter((x) => x !== c.value))} />{c.label}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    case "person":
      return <Field label={label}><Input disabled value="" placeholder="A team member is chosen here when the form runs" readOnly /></Field>;
    case "file_upload":
      return <Field label={label}><Input type="file" disabled /></Field>;
    default:
      return <p className="text-xs text-fg-3">{label} (not available yet)</p>;
  }
}

export function PreviewTab({ def, timeZone, versionNumber }: { def: FormDefinition; timeZone: string; versionNumber: number | null }) {
  const [answers, setAnswers] = React.useState<Answers>({});
  const [starterRole, setStarterRole] = React.useState<AppRole>("acquisitions");
  const result = React.useMemo<{ ev: Evaluation | null; error: string | null }>(() => {
    try {
      return { ev: evaluate(def, answers, { starterRole, versionNumber: (versionNumber ?? 0) + 1, createdAt: new Date(), now: new Date(), timeZone }), error: null };
    } catch (err) {
      return { ev: null, error: err instanceof Error ? err.message : "The rules could not run." };
    }
  }, [def, answers, starterRole, versionNumber, timeZone]);
  const ev = result.ev;
  const roleLabel = (key: string) => def.roles.find((r) => r.key === key)?.label ?? key;
  const sections = orderedSections(def);

  return (
    <div className="space-y-4" aria-label="Preview">
      <Alert tone="info">This is a preview. Answers typed here are not saved. Rules react as you type.</Alert>
      {result.error ? <Alert tone="bad">The rules could not run: {result.error}</Alert> : null}
      <div className="flex items-end gap-2">
        <Field label="Preview as starter role" className="w-52"><Select value={starterRole} onChange={(e) => setStarterRole(e.target.value as AppRole)}>{APP_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
        <Button type="button" variant="outline" size="sm" onClick={() => setAnswers({})}>Clear sample answers</Button>
      </div>
      {sections.length === 0 ? <p className="text-[13px] text-fg-3">Add a section and a field to see the preview.</p> : null}
      {sections.map((s, si) => {
        const hidden = ev ? ev.sectionVisible[s.key] === false : false;
        const skipped = ev ? ev.skippedSections.includes(s.key) : false;
        const owner = ev ? ev.assignments[s.key] ?? s.ownerRole : s.ownerRole;
        return (
          <section key={s.key} className={hidden || skipped ? "rounded-lg border border-dashed border-border bg-surface-2/50 p-4" : "rounded-lg border border-border bg-surface p-4"} aria-label={`Preview of ${s.title}`}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold">{si + 1}. {s.title}</h3>
              <Badge>{roleLabel(owner)}</Badge>
              {s.needsApproval ? <Badge tone="info">Approval</Badge> : null}
              {hidden ? <Badge tone="warn">Hidden by a rule</Badge> : null}
              {skipped ? <Badge tone="warn">Skipped by a rule</Badge> : null}
            </div>
            {s.description ? <p className="text-xs text-fg-3 mb-3">{s.description}</p> : null}
            <div className="space-y-3">
              {sortByOrder(s.fields).map((f) => {
                const visible = ev ? ev.fieldVisible[f.key] !== false : !f.hiddenByDefault;
                if (!visible) return null;
                const required = ev ? ev.fieldRequired[f.key] === true : f.required;
                const fromRule = ev !== null && f.key in ev.setValues;
                const value = fromRule ? ev!.setValues[f.key] : answers[f.key] ?? f.default;
                return (
                  <div key={f.key}>
                    <PreviewInput field={f} value={value} locked={hidden || skipped || fromRule} onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))} />
                    <div className="flex gap-2 mt-0.5">
                      {required && f.type !== "content" ? <span className="text-[11px] text-bad">Required</span> : null}
                      {fromRule ? <span className="text-[11px] text-fg-3">Set by a rule</span> : null}
                      {f.help ? <span className="text-[11px] text-fg-3">{f.help}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
