"use client";
import * as React from "react";
import type { DueRule, FormDefinition } from "@dealcalc/forms";
import { Field, Input, Select } from "@/components/ui/input";

export function Check({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-[13px] text-fg cursor-pointer">
      <input type="checkbox" className="mt-0.5 h-3.5 w-3.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint ? <span className="block text-xs text-fg-3">{hint}</span> : null}</span>
    </label>
  );
}

/** A number box that reports undefined when empty. */
export function NumberField({ label, value, onChange, step, min, className }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; className?: string }) {
  return (
    <Field label={label} className={className}>
      <Input type="number" step={step} min={min} value={value ?? ""} onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(undefined);
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }} />
    </Field>
  );
}

export function DueRuleEditor({ rule, onChange, def, label = "Due date", required }: { rule: DueRule | undefined; onChange: (r: DueRule | undefined) => void; def: FormDefinition; label?: string; required?: boolean }) {
  const dateFields = def.sections.flatMap((s) => s.fields.filter((f) => f.type === "date").map((f) => ({ key: f.key, label: f.label })));
  const current: DueRule = rule ?? { from: "submission_start", offset: 1, unit: "days" };
  return (
    <fieldset className="rounded-md border border-border p-2.5 space-y-2">
      <legend className="px-1 text-xs font-medium text-fg-2">{label}</legend>
      {required ? null : (
        <Field label={`${label} rule`}>
          <Select value={rule ? "on" : "off"} onChange={(e) => onChange(e.target.value === "on" ? current : undefined)}>
            <option value="off">No due date</option>
            <option value="on">Set a due date</option>
          </Select>
        </Field>
      )}
      {rule ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={`${label} offset`} value={rule.offset} step={1} onChange={(v) => onChange({ ...rule, offset: v === undefined ? 0 : Math.trunc(v) })} />
            <Field label={`${label} unit`}>
              <Select value={rule.unit} onChange={(e) => onChange({ ...rule, unit: e.target.value as DueRule["unit"] })}>
                <option value="hours">Hours</option><option value="days">Days</option><option value="business_days">Business days</option>
              </Select>
            </Field>
          </div>
          <Field label={`${label} counts from`}>
            <Select value={rule.from} onChange={(e) => onChange({ ...rule, from: e.target.value as DueRule["from"], fieldKey: e.target.value === "date_field" ? rule.fieldKey ?? dateFields[0]?.key : undefined })}>
              <option value="submission_start">Submission start</option>
              <option value="previous_section">Previous section completed</option>
              <option value="date_field">A date field</option>
            </Select>
          </Field>
          {rule.from === "date_field" ? (
            <Field label={`${label} date field`}>
              <Select value={rule.fieldKey ?? ""} onChange={(e) => onChange({ ...rule, fieldKey: e.target.value || undefined })}>
                <option value="">Choose a date field</option>
                {dateFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </Select>
            </Field>
          ) : null}
          <p className="text-xs text-fg-3">A negative offset counts back from the starting point.</p>
        </>
      ) : null}
    </fieldset>
  );
}
