"use client";
import * as React from "react";
import {
  APP_ROLES, isConditionGroup, sortByOrder,
  type Condition, type ConditionGroup, type DueRule, type FieldDef, type FormDefinition, type Operator, type Rule, type RuleAction,
} from "@dealcalc/forms";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Check, DueRuleEditor } from "./controls";
import { newRule, ROLE_LABELS } from "./model";

const OP_LABELS: Record<Operator, string> = {
  equals: "Equals", not_equals: "Does not equal", contains: "Contains", is_empty: "Is empty", is_not_empty: "Is not empty",
  gt: "Is greater than", lt: "Is less than", gte: "Is at least", lte: "Is at most", before: "Is before", after: "Is after", is_one_of: "Is one of",
};

type Kind = "text" | "number" | "date" | "single" | "multi" | "yesno" | "other" | "starter_role" | "version" | "created_at";

function opsFor(kind: Kind): Operator[] {
  switch (kind) {
    case "text": return ["equals", "not_equals", "contains", "is_empty", "is_not_empty"];
    case "number": return ["equals", "not_equals", "gt", "lt", "gte", "lte", "is_empty", "is_not_empty"];
    case "date": return ["equals", "before", "after", "is_empty", "is_not_empty"];
    case "single": return ["equals", "not_equals", "is_one_of", "is_empty", "is_not_empty"];
    case "multi": return ["contains", "is_one_of", "is_empty", "is_not_empty"];
    case "yesno": return ["equals"];
    case "starter_role": return ["equals", "is_one_of"];
    case "version": return ["equals", "gt", "lt", "gte", "lte"];
    case "created_at": return ["before", "after"];
    default: return ["is_empty", "is_not_empty"];
  }
}

function kindOfType(t: string | undefined): Kind {
  switch (t) {
    case "short_text": case "long_text": return "text";
    case "number": return "number";
    case "date": return "date";
    case "single_choice": return "single";
    case "multiple_choice": return "multi";
    case "yes_no": return "yesno";
    default: return "other";
  }
}

function allFields(def: FormDefinition): FieldDef[] {
  return sortByOrder(def.sections).flatMap((s) => sortByOrder(s.fields)).filter((f) => f.type !== "content");
}

/** Edits one value for a kind. Used by conditions and by the set value action. */
function ValueInput({ kind, op, field, value, onChange, label }: { kind: Kind; op: Operator | "set"; field?: FieldDef; value: unknown; onChange: (v: unknown) => void; label: string }) {
  if (op === "is_empty" || op === "is_not_empty") return null;
  const choices = field?.options.choices ?? [];
  if (op === "is_one_of") {
    const options = kind === "starter_role" ? APP_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })) : choices;
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
        <legend className="sr-only">{label}</legend>
        {options.map((c) => <Check key={c.value} label={`${label}: ${c.label}`} checked={list.includes(c.value)} onChange={(v) => onChange(v ? [...list, c.value] : list.filter((x) => x !== c.value))} />)}
      </fieldset>
    );
  }
  if (kind === "yesno") {
    return <Select aria-label={label} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "yes" ? true : e.target.value === "no" ? false : undefined)}><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></Select>;
  }
  if (kind === "single" || kind === "multi") {
    return <Select aria-label={label} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)}><option value="">Choose</option>{choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select>;
  }
  if (kind === "starter_role") {
    return <Select aria-label={label} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)}><option value="">Choose</option>{APP_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>;
  }
  if (kind === "number" || kind === "version") {
    return <Input aria-label={label} type="number" value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
  }
  if (kind === "date" || kind === "created_at") {
    return <Input aria-label={label} type="date" value={typeof value === "string" ? value.slice(0, 10) : ""} onChange={(e) => onChange(e.target.value || undefined)} />;
  }
  return <Input aria-label={label} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} />;
}

const META_SOURCES = [
  { key: "starter_role", label: "Role of the person who started the form" },
  { key: "version", label: "Form version number" },
  { key: "created_at", label: "Date the submission was created" },
] as const;

function ConditionEditor({ cond, def, prefix, onChange, onRemove }: { cond: Condition; def: FormDefinition; prefix: string; onChange: (c: Condition) => void; onRemove: () => void }) {
  const fields = allFields(def);
  const field = cond.source.kind === "field" ? fields.find((f) => f.key === cond.source.key) : undefined;
  const kind: Kind = cond.source.kind === "meta" ? (cond.source.key as Kind) : kindOfType(field?.type);
  const ops = opsFor(kind);
  const sourceValue = cond.source.kind === "field" ? `field:${cond.source.key}` : `meta:${cond.source.key}`;
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      <Field label={`${prefix} field`} className="w-52">
        <Select value={sourceValue} onChange={(e) => {
          const [k, key] = e.target.value.split(":") as ["field" | "meta", string];
          const nextKind: Kind = k === "meta" ? (key as Kind) : kindOfType(fields.find((f) => f.key === key)?.type);
          onChange({ source: k === "meta" ? { kind: "meta", key: key as "starter_role" | "version" | "created_at" } : { kind: "field", key }, op: opsFor(nextKind)[0]!, value: undefined });
        }}>
          {!field && cond.source.kind === "field" ? <option value={sourceValue}>{cond.source.key} (missing)</option> : null}
          <optgroup label="Fields">{fields.map((f) => <option key={f.key} value={`field:${f.key}`}>{f.label}</option>)}</optgroup>
          <optgroup label="Submission">{META_SOURCES.map((m) => <option key={m.key} value={`meta:${m.key}`}>{m.label}</option>)}</optgroup>
        </Select>
      </Field>
      <Field label={`${prefix} operator`} className="w-40">
        <Select value={cond.op} onChange={(e) => {
          const op = e.target.value as Operator;
          onChange({ ...cond, op, value: op === "is_one_of" ? [] : op === "is_empty" || op === "is_not_empty" ? undefined : Array.isArray(cond.value) ? undefined : cond.value });
        }}>
          {ops.map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
          {!ops.includes(cond.op) ? <option value={cond.op}>{OP_LABELS[cond.op]}</option> : null}
        </Select>
      </Field>
      <div className="min-w-[8rem] flex-1">
        <ValueInput kind={kind} op={cond.op} field={field} value={cond.value} label={`${prefix} value`} onChange={(v) => onChange({ ...cond, value: v })} />
      </div>
      <Button type="button" size="iconSm" variant="ghost" aria-label={`Remove ${prefix}`} onClick={onRemove}><X className="h-3.5 w-3.5" /></Button>
    </div>
  );
}

function newCondition(def: FormDefinition): Condition {
  const f = allFields(def)[0];
  return f ? { source: { kind: "field", key: f.key }, op: opsFor(kindOfType(f.type))[0]! } : { source: { kind: "meta", key: "starter_role" }, op: "equals" };
}

function GroupEditor({ group, def, prefix, depth, onChange, onRemove }: { group: ConditionGroup; def: FormDefinition; prefix: string; depth: number; onChange: (g: ConditionGroup) => void; onRemove?: () => void }) {
  const set = (conditions: ConditionGroup["conditions"]) => onChange({ ...group, conditions });
  return (
    <div className={depth === 0 ? "space-y-2" : "space-y-2 rounded-md border border-border/80 bg-surface-2/50 p-2"}>
      <div className="flex items-end gap-2">
        <Field label={`${prefix} match`} className="w-56">
          <Select value={group.combinator} onChange={(e) => onChange({ ...group, combinator: e.target.value as "and" | "or" })}>
            <option value="and">All of these are true (AND)</option>
            <option value="or">Any of these is true (OR)</option>
          </Select>
        </Field>
        {onRemove ? <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${prefix}`} onClick={onRemove}><Trash2 className="h-3.5 w-3.5" />Remove group</Button> : null}
      </div>
      {group.conditions.map((c, i) => isConditionGroup(c)
        ? <GroupEditor key={i} group={c} def={def} prefix={`${prefix} group ${i + 1}`} depth={depth + 1} onChange={(g) => set(group.conditions.map((x, j) => (j === i ? g : x)))} onRemove={() => set(group.conditions.filter((_, j) => j !== i))} />
        : <ConditionEditor key={i} cond={c} def={def} prefix={`${prefix} condition ${i + 1}`} onChange={(n) => set(group.conditions.map((x, j) => (j === i ? n : x)))} onRemove={() => set(group.conditions.filter((_, j) => j !== i))} />)}
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" aria-label={`Add condition to ${prefix}`} onClick={() => set([...group.conditions, newCondition(def)])}><Plus className="h-3.5 w-3.5" />Add condition</Button>
        {depth === 0 ? <Button type="button" size="sm" variant="outline" aria-label={`Add group to ${prefix}`} onClick={() => set([...group.conditions, { combinator: "or", conditions: [newCondition(def)] }])}><Plus className="h-3.5 w-3.5" />Add group</Button> : null}
      </div>
    </div>
  );
}

/* --------------------------------- actions --------------------------------- */

const ACTION_LABELS: Record<RuleAction["kind"], string> = {
  show: "Show", hide: "Hide", require: "Make required", optional: "Make optional", set_value: "Set value",
  skip_section: "Skip section", assign: "Assign section to role", change_due: "Change section due date",
};

const DEFAULT_DUE: DueRule = { from: "submission_start", offset: 1, unit: "days" };

function defaultAction(kind: RuleAction["kind"], def: FormDefinition): RuleAction {
  const field = allFields(def)[0]?.key ?? "";
  const section = def.sections[0]?.key ?? "";
  switch (kind) {
    case "show": case "hide": return { kind, target: { kind: "field", key: field } };
    case "require": case "optional": return { kind, fieldKey: field };
    case "set_value": return { kind, fieldKey: field, value: undefined };
    case "skip_section": return { kind, sectionKey: section };
    case "assign": return { kind, sectionKey: section, roleKey: def.roles[0]?.key ?? "" };
    case "change_due": return { kind, sectionKey: section, dueRule: DEFAULT_DUE };
  }
}

function ActionEditor({ action, def, prefix, onChange, onRemove }: { action: RuleAction; def: FormDefinition; prefix: string; onChange: (a: RuleAction) => void; onRemove: () => void }) {
  const fields = allFields(def);
  const sections = sortByOrder(def.sections);
  const fieldSelect = (label: string, value: string, set: (k: string) => void) => (
    <Field label={label} className="w-48"><Select value={value} onChange={(e) => set(e.target.value)}>
      {!fields.some((f) => f.key === value) ? <option value={value}>{value || "Choose a field"}</option> : null}
      {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
    </Select></Field>
  );
  const sectionSelect = (label: string, value: string, set: (k: string) => void) => (
    <Field label={label} className="w-48"><Select value={value} onChange={(e) => set(e.target.value)}>
      {!sections.some((s) => s.key === value) ? <option value={value}>{value || "Choose a section"}</option> : null}
      {sections.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
    </Select></Field>
  );
  return (
    <div className="space-y-1.5 rounded-md border border-border/70 p-2">
      <div className="flex flex-wrap items-end gap-1.5">
        <Field label={`${prefix} type`} className="w-52">
          <Select value={action.kind} onChange={(e) => onChange(defaultAction(e.target.value as RuleAction["kind"], def))}>
            {(Object.keys(ACTION_LABELS) as RuleAction["kind"][]).map((k) => <option key={k} value={k}>{ACTION_LABELS[k]}</option>)}
          </Select>
        </Field>
        {(action.kind === "show" || action.kind === "hide") ? (
          <Field label={`${prefix} target`} className="w-56">
            <Select value={`${action.target.kind}:${action.target.key}`} onChange={(e) => { const [k, ...rest] = e.target.value.split(":"); onChange({ kind: action.kind, target: { kind: k as "field" | "section", key: rest.join(":") } }); }}>
              <optgroup label="Fields">{fields.map((f) => <option key={f.key} value={`field:${f.key}`}>{f.label}</option>)}</optgroup>
              <optgroup label="Sections">{sections.map((s) => <option key={s.key} value={`section:${s.key}`}>{s.title}</option>)}</optgroup>
            </Select>
          </Field>
        ) : null}
        {(action.kind === "require" || action.kind === "optional") ? fieldSelect(`${prefix} field`, action.fieldKey, (k) => onChange({ ...action, fieldKey: k })) : null}
        {action.kind === "set_value" ? (
          <>
            {fieldSelect(`${prefix} field`, action.fieldKey, (k) => onChange({ kind: "set_value", fieldKey: k, value: undefined }))}
            <div className="min-w-[8rem] flex-1">
              {(() => {
                const f = fields.find((x) => x.key === action.fieldKey);
                return <ValueInput kind={kindOfType(f?.type)} op="set" field={f} value={action.value} label={`${prefix} value`} onChange={(v) => onChange({ ...action, value: v })} />;
              })()}
            </div>
          </>
        ) : null}
        {action.kind === "skip_section" ? sectionSelect(`${prefix} section`, action.sectionKey, (k) => onChange({ ...action, sectionKey: k })) : null}
        {action.kind === "assign" ? (
          <>
            {sectionSelect(`${prefix} section`, action.sectionKey, (k) => onChange({ ...action, sectionKey: k }))}
            <Field label={`${prefix} role`} className="w-44"><Select value={action.roleKey} onChange={(e) => onChange({ ...action, roleKey: e.target.value })}>
              {!def.roles.some((r) => r.key === action.roleKey) ? <option value={action.roleKey}>{action.roleKey || "Choose a role"}</option> : null}
              {def.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </Select></Field>
          </>
        ) : null}
        {action.kind === "change_due" ? sectionSelect(`${prefix} section`, action.sectionKey, (k) => onChange({ ...action, sectionKey: k })) : null}
        <Button type="button" size="iconSm" variant="ghost" aria-label={`Remove ${prefix}`} onClick={onRemove}><X className="h-3.5 w-3.5" /></Button>
      </div>
      {action.kind === "change_due" ? <DueRuleEditor required rule={action.dueRule} def={def} label={`${prefix} due date`} onChange={(r) => onChange({ ...action, dueRule: r ?? DEFAULT_DUE })} /> : null}
    </div>
  );
}

/* ---------------------------------- tab ---------------------------------- */

export function RulesTab({ def, onChange, ruleErrors }: { def: FormDefinition; onChange: (rules: Rule[]) => void; ruleErrors: Map<number, string[]> }) {
  const rules = def.rules;
  const setRule = (i: number, r: Rule) => onChange(rules.map((x, j) => (j === i ? r : x)));
  const noFields = allFields(def).length === 0;
  return (
    <div className="space-y-4" aria-label="Rules">
      <p className="text-[13px] text-fg-2">Each rule reads: when these conditions are true, do these actions. Rules run in the order listed, and a rule can only read fields that come before what it changes.</p>
      {noFields ? <p className="text-xs text-fg-3">Add fields on the Form tab before building rules.</p> : null}
      {rules.map((rule, i) => {
        const prefix = `Rule ${i + 1}`;
        const errors = ruleErrors.get(i) ?? [];
        return (
          <section key={rule.id} aria-label={prefix} className="rounded-lg border border-border bg-surface p-3 space-y-3">
            <div className="flex items-end gap-2">
              <Field label={`${prefix} name`} className="flex-1"><Input value={rule.label ?? ""} placeholder={rule.id} onChange={(e) => setRule(i, { ...rule, label: e.target.value || undefined })} /></Field>
              <Button type="button" size="iconSm" variant="ghost" aria-label={`Move up ${prefix}`} title="Move up" disabled={i === 0} onClick={() => { const next = [...rules]; const [m] = next.splice(i, 1); next.splice(i - 1, 0, m!); onChange(next); }}><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button type="button" size="iconSm" variant="ghost" aria-label={`Move down ${prefix}`} title="Move down" disabled={i === rules.length - 1} onClick={() => { const next = [...rules]; const [m] = next.splice(i, 1); next.splice(i + 1, 0, m!); onChange(next); }}><ArrowDown className="h-3.5 w-3.5" /></Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`Delete ${prefix}`} onClick={() => onChange(rules.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" />Delete</Button>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3 mb-1.5">When</h3>
              <GroupEditor group={rule.when} def={def} prefix={`${prefix} when`} depth={0} onChange={(g) => setRule(i, { ...rule, when: g })} />
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3 mb-1.5">Then</h3>
              <div className="space-y-2">
                {rule.then.map((a, ai) => (
                  <ActionEditor key={ai} action={a} def={def} prefix={`${prefix} action ${ai + 1}`} onChange={(n) => setRule(i, { ...rule, then: rule.then.map((x, j) => (j === ai ? n : x)) })} onRemove={() => rule.then.length > 1 && setRule(i, { ...rule, then: rule.then.filter((_, j) => j !== ai) })} />
                ))}
                <Button type="button" size="sm" variant="outline" aria-label={`Add action to ${prefix}`} onClick={() => setRule(i, { ...rule, then: [...rule.then, defaultAction("show", def)] })}><Plus className="h-3.5 w-3.5" />Add action</Button>
              </div>
            </div>
            {errors.length ? <ul className="text-xs text-bad space-y-0.5" role="alert">{errors.map((m, k) => <li key={k}>{m}</li>)}</ul> : null}
          </section>
        );
      })}
      <Button type="button" variant="outline" disabled={noFields && def.sections.length === 0} onClick={() => onChange([...rules, newRule(def)])}><Plus className="h-4 w-4" />Add rule</Button>
    </div>
  );
}
