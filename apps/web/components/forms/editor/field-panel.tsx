"use client";
import * as React from "react";
import { APP_ROLES, FIELD_TYPES, type FieldDef, type FieldOptions, type FieldType, type FormDefinition } from "@dealcalc/forms";
import { Plus, Trash2, X } from "lucide-react";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Check, NumberField } from "./controls";
import { FIELD_TYPE_LABELS, ROLE_LABELS, slugKey } from "./model";

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

function ChoiceEditor({ options, onChange }: { options: FieldOptions; onChange: (patch: Partial<FieldOptions>) => void }) {
  const choices = options.choices ?? [];
  const set = (next: typeof choices) => onChange({ choices: next });
  return (
    <fieldset className="rounded-md border border-border p-2.5 space-y-2">
      <legend className="px-1 text-xs font-medium text-fg-2">Choices</legend>
      {choices.map((c, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5 items-end">
          <Field label={`Choice ${i + 1} label`}>
            <Input value={c.label} onChange={(e) => {
              const label = e.target.value;
              const synced = /^option_\d+$/.test(c.value) || c.value === slugKey(c.label, new Set(), "option");
              const taken = new Set(choices.filter((_, j) => j !== i).map((x) => x.value));
              set(choices.map((x, j) => (j === i ? { label, value: synced && label.trim() ? slugKey(label, taken, "option") : x.value } : x)));
            }} />
          </Field>
          <Field label={`Choice ${i + 1} value`}><Input value={c.value} onChange={(e) => set(choices.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} /></Field>
          <Button type="button" size="iconSm" variant="ghost" aria-label={`Remove choice ${i + 1}`} onClick={() => set(choices.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => {
        const n = choices.length + 1;
        set([...choices, { value: slugKey(`option ${n}`, new Set(choices.map((x) => x.value)), "option"), label: `Option ${n}` }]);
      }}><Plus className="h-3.5 w-3.5" />Add choice</Button>
    </fieldset>
  );
}

function DefaultValue({ field, onChange }: { field: FieldDef; onChange: (v: unknown) => void }) {
  const v = field.default;
  switch (field.type) {
    case "short_text": case "long_text":
      return <Field label="Default value"><Input value={typeof v === "string" ? v : ""} onChange={(e) => onChange(e.target.value || undefined)} /></Field>;
    case "number":
      return <NumberField label="Default value" value={typeof v === "number" ? v : undefined} onChange={onChange} />;
    case "date":
      return <Field label="Default value"><Input type="date" value={typeof v === "string" ? v.slice(0, 10) : ""} onChange={(e) => onChange(e.target.value || undefined)} /></Field>;
    case "yes_no":
      return (
        <Field label="Default value">
          <Select value={v === true ? "yes" : v === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "yes" ? true : e.target.value === "no" ? false : undefined)}>
            <option value="">No default</option><option value="yes">Yes</option><option value="no">No</option>
          </Select>
        </Field>
      );
    case "single_choice":
      return (
        <Field label="Default value">
          <Select value={typeof v === "string" ? v : ""} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">No default</option>
            {(field.options.choices ?? []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
      );
    default:
      return null;
  }
}

export function FieldPanel({ field, def, keyLocked, takenKeys, onChange, onOptions, onRenameKey, onChangeType, onDelete }: {
  field: FieldDef; def: FormDefinition; keyLocked: boolean; takenKeys: Set<string>;
  onChange: (patch: Partial<FieldDef>) => void;
  onOptions: (patch: Partial<FieldOptions>) => void;
  onRenameKey: (next: string) => void;
  onChangeType: (t: FieldType) => void;
  onDelete: () => void;
}) {
  const [keyDraft, setKeyDraft] = React.useState(field.key);
  React.useEffect(() => setKeyDraft(field.key), [field.key]);
  const keyError = keyDraft === field.key ? null : !KEY_PATTERN.test(keyDraft) ? "Use lower case letters, digits, and underscores, starting with a letter." : takenKeys.has(keyDraft) ? "Another field already uses this key." : null;
  const o = field.options;
  const t = field.type;
  const optionPatch = (patch: Partial<FieldOptions>) => onOptions(patch);
  const dateBound = (name: "earliest" | "latest", label: string) => {
    const val = o[name] ?? "";
    return <Field label={label}><Input type={val.startsWith("field:") ? "text" : "date"} value={val} onChange={(e) => optionPatch({ [name]: e.target.value || undefined })} /></Field>;
  };

  return (
    <div className="space-y-3" aria-label="Field settings">
      <h2 className="text-sm font-semibold">Field settings</h2>
      <Field label="Field type">
        <Select value={t} onChange={(e) => {
          if (window.confirm("Changing the type resets the type options for this field. Continue?")) onChangeType(e.target.value as FieldType);
        }}>
          {FIELD_TYPES.map((x) => <option key={x} value={x}>{FIELD_TYPE_LABELS[x]}</option>)}
        </Select>
      </Field>
      <Field label="Field label"><Input value={field.label} onChange={(e) => onChange({ label: e.target.value })} /></Field>
      <Field label="Help text"><Textarea value={field.help ?? ""} onChange={(e) => onChange({ help: e.target.value || undefined })} /></Field>
      <div>
        <Field label="Field key" error={keyError ?? undefined}>
          <Input value={keyDraft} readOnly={keyLocked} onChange={(e) => setKeyDraft(e.target.value)} onBlur={() => { if (!keyLocked && !keyError && keyDraft !== field.key) onRenameKey(keyDraft); else setKeyDraft(field.key); }} />
        </Field>
        <p className="text-xs text-fg-3 mt-1">{keyLocked ? "This key is in a published version and can no longer change. Reports and rules depend on it." : "Changing the key breaks reports and integrations that already use the old key. It can change until the form is published."}</p>
      </div>

      {t !== "content" ? (
        <div className="space-y-2">
          <Check label="Required" checked={field.required} onChange={(v) => onChange({ required: v })} />
          <Check label="Read only" checked={field.readOnly} onChange={(v) => onChange({ readOnly: v })} />
          <Check label="Hidden by default" hint="A rule can show it later." checked={field.hiddenByDefault} onChange={(v) => onChange({ hiddenByDefault: v })} />
          <Check label="Unique across submissions" checked={field.unique} onChange={(v) => onChange({ unique: v })} />
        </div>
      ) : <Check label="Hidden by default" checked={field.hiddenByDefault} onChange={(v) => onChange({ hiddenByDefault: v })} />}

      <DefaultValue field={field} onChange={(v) => onChange({ default: v })} />

      {t === "short_text" ? (
        <fieldset className="rounded-md border border-border p-2.5 space-y-2">
          <legend className="px-1 text-xs font-medium text-fg-2">Text options</legend>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Minimum length" min={0} value={o.minLength} onChange={(v) => optionPatch({ minLength: v })} />
            <NumberField label="Maximum length" min={1} value={o.maxLength} onChange={(v) => optionPatch({ maxLength: v })} />
          </div>
          <Field label="Pattern">
            <Select value={o.pattern ?? ""} onChange={(e) => optionPatch({ pattern: (e.target.value || undefined) as FieldOptions["pattern"], regex: e.target.value === "custom" ? o.regex : undefined })}>
              <option value="">None</option><option value="email">Email</option><option value="phone">Phone</option><option value="url">URL</option><option value="custom">Custom expression</option>
            </Select>
          </Field>
          {o.pattern === "custom" ? <Field label="Regular expression"><Input value={o.regex ?? ""} onChange={(e) => optionPatch({ regex: e.target.value || undefined })} /></Field> : null}
          <Field label="Placeholder"><Input value={o.placeholder ?? ""} onChange={(e) => optionPatch({ placeholder: e.target.value || undefined })} /></Field>
        </fieldset>
      ) : null}

      {t === "long_text" ? (
        <fieldset className="rounded-md border border-border p-2.5 space-y-2">
          <legend className="px-1 text-xs font-medium text-fg-2">Text options</legend>
          <NumberField label="Character limit" min={1} value={o.maxLength} onChange={(v) => optionPatch({ maxLength: v })} />
          <Field label="Placeholder"><Input value={o.placeholder ?? ""} onChange={(e) => optionPatch({ placeholder: e.target.value || undefined })} /></Field>
          <Check label="Rich text" checked={o.rich === true} onChange={(v) => optionPatch({ rich: v || undefined })} />
        </fieldset>
      ) : null}

      {t === "number" ? (
        <fieldset className="rounded-md border border-border p-2.5 space-y-2">
          <legend className="px-1 text-xs font-medium text-fg-2">Number options</legend>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Minimum value" value={o.min} onChange={(v) => optionPatch({ min: v })} />
            <NumberField label="Maximum value" value={o.max} onChange={(v) => optionPatch({ max: v })} />
            <NumberField label="Decimal places" min={0} step={1} value={o.decimals} onChange={(v) => optionPatch({ decimals: v === undefined ? undefined : Math.min(6, Math.max(0, Math.trunc(v))) })} />
            <Field label="Unit"><Input value={o.unit ?? ""} onChange={(e) => optionPatch({ unit: e.target.value || undefined })} /></Field>
          </div>
          <Check label="Show as dollars" checked={o.currency === true} onChange={(v) => optionPatch({ currency: v || undefined })} />
          <Check label="Thousands separator" checked={o.thousandsSeparator === true} onChange={(v) => optionPatch({ thousandsSeparator: v || undefined })} />
        </fieldset>
      ) : null}

      {t === "date" ? (
        <fieldset className="rounded-md border border-border p-2.5 space-y-2">
          <legend className="px-1 text-xs font-medium text-fg-2">Date options</legend>
          {dateBound("earliest", "Earliest allowed date")}
          {dateBound("latest", "Latest allowed date")}
          <Check label="Business days only" checked={o.businessDaysOnly === true} onChange={(v) => optionPatch({ businessDaysOnly: v || undefined })} />
          <Check label="Include a time" checked={o.withTime === true} onChange={(v) => optionPatch({ withTime: v || undefined })} />
        </fieldset>
      ) : null}

      {t === "single_choice" || t === "multiple_choice" ? (
        <>
          <ChoiceEditor options={o} onChange={optionPatch} />
          {t === "single_choice" ? (
            <Field label="Display as">
              <Select value={o.display === "radio" ? "radio" : "dropdown"} onChange={(e) => optionPatch({ display: e.target.value as "dropdown" | "radio" })}>
                <option value="dropdown">Dropdown</option><option value="radio">Radio buttons</option>
              </Select>
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Minimum selections" min={0} step={1} value={o.minSelections} onChange={(v) => optionPatch({ minSelections: v })} />
              <NumberField label="Maximum selections" min={1} step={1} value={o.maxSelections} onChange={(v) => optionPatch({ maxSelections: v })} />
            </div>
          )}
          <Check label='Allow an "Other" answer with text' checked={o.allowOther === true} onChange={(v) => optionPatch({ allowOther: v || undefined })} />
        </>
      ) : null}

      {t === "yes_no" ? (
        <fieldset className="rounded-md border border-border p-2.5 space-y-2">
          <legend className="px-1 text-xs font-medium text-fg-2">Yes or no options</legend>
          <Field label="Label for yes"><Input value={o.yesLabel ?? ""} placeholder="Yes" onChange={(e) => optionPatch({ yesLabel: e.target.value || undefined })} /></Field>
          <Field label="Label for no"><Input value={o.noLabel ?? ""} placeholder="No" onChange={(e) => optionPatch({ noLabel: e.target.value || undefined })} /></Field>
        </fieldset>
      ) : null}

      {t === "person" ? (
        <fieldset className="rounded-md border border-border p-2.5 space-y-2">
          <legend className="px-1 text-xs font-medium text-fg-2">Person options</legend>
          <Check label="Allow several people" checked={o.multiple === true} onChange={(v) => optionPatch({ multiple: v || undefined })} />
          <Field label="Limit to role">
            <Select value={o.limitToRole ?? ""} onChange={(e) => optionPatch({ limitToRole: (e.target.value || undefined) as FieldOptions["limitToRole"] })}>
              <option value="">Anyone on the team</option>
              {APP_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </Field>
        </fieldset>
      ) : null}

      {t === "file_upload" ? (
        <fieldset className="rounded-md border border-border p-2.5 space-y-2">
          <legend className="px-1 text-xs font-medium text-fg-2">File options</legend>
          <Field label="Allowed file types" hint="Comma separated, for example pdf, jpg, png. Leave empty to allow the usual document and image types.">
            <Input value={(o.allowedTypes ?? []).join(", ")} onChange={(e) => {
              const list = e.target.value.split(",").map((x) => x.trim().replace(/^\./, "")).filter(Boolean);
              optionPatch({ allowedTypes: list.length ? list : undefined });
            }} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Maximum size in MB" min={1} value={o.maxSizeMb} onChange={(v) => optionPatch({ maxSizeMb: v })} />
            <NumberField label="Maximum number of files" min={1} step={1} value={o.maxFiles} onChange={(v) => optionPatch({ maxFiles: v === undefined ? undefined : Math.trunc(v) })} />
          </div>
        </fieldset>
      ) : null}

      {t === "content" ? (
        <Field label="Content text" hint="Shown to the person filling the form. Merge tags such as {{first_name}} are allowed.">
          <Textarea value={o.body ?? ""} onChange={(e) => optionPatch({ body: e.target.value || undefined })} />
        </Field>
      ) : null}

      <fieldset className="rounded-md border border-border p-2.5 space-y-2">
        <legend className="px-1 text-xs font-medium text-fg-2">Who can see this field</legend>
        {def.roles.length === 0 ? <p className="text-xs text-fg-3">Add roles on the Roles tab to limit this field to named roles. Until then every role sees it.</p> : (
          <>
            <p className="text-xs text-fg-3">Leave all unchecked to show it to every role.</p>
            {def.roles.map((r) => (
              <Check key={r.key} label={`Visible to ${r.label}`} checked={field.visibleToRoles.includes(r.key)} onChange={(v) => onChange({ visibleToRoles: v ? [...field.visibleToRoles, r.key] : field.visibleToRoles.filter((x) => x !== r.key) })} />
            ))}
          </>
        )}
        <Check label="Visible to external people" checked={field.visibleToExternal} onChange={(v) => onChange({ visibleToExternal: v })} />
      </fieldset>

      {keyLocked ? <Alert tone="warn">Deleting a published field keeps its past answers in history but removes it from reports.</Alert> : null}
      <Button type="button" variant="danger" size="sm" onClick={() => { if (window.confirm(`Delete the field "${field.label}" from the draft?`)) onDelete(); }}><Trash2 className="h-3.5 w-3.5" />Delete field</Button>
    </div>
  );
}
