"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { FieldDef } from "@dealcalc/forms";
import { renderMergeTags } from "@dealcalc/forms";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TeamOption = { id: string; name: string; role?: string };
export type FileUploadResult = { ok: boolean; error?: string; id?: string };
export type ChangeOptions = { immediate?: boolean };

/** Choice labels for merge tags and read only display, keyed by field key. */
export function labelsFor(fields: FieldDef[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const f of fields) if (f.options.choices) out[f.key] = Object.fromEntries(f.options.choices.map((c) => [c.value, c.label]));
  return out;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === null || value === undefined || value === "" ? [] : [value];
}

/** Plain text for a stored answer, used by the earlier answers summary and the history list. */
export function displayValue(field: FieldDef, value: unknown, team: TeamOption[] = []): string {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return "Not answered";
  const list = asList(value);
  switch (field.type) {
    case "yes_no": return value === true ? (field.options.yesLabel || "Yes") : value === false ? (field.options.noLabel || "No") : String(value);
    case "single_choice":
    case "multiple_choice": return list.map((v) => field.options.choices?.find((c) => c.value === v)?.label ?? String(v)).join(", ");
    case "person": return list.map((v) => team.find((t) => t.id === v)?.name ?? "A team member").join(", ");
    case "file_upload": return `${list.length} file${list.length === 1 ? "" : "s"} attached`;
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return String(value);
      const o = field.options;
      const text = o.thousandsSeparator || o.currency ? n.toLocaleString("en-US", { maximumFractionDigits: 6 }) : String(n);
      return `${o.currency ? "$" : ""}${text}${o.unit ? ` ${o.unit}` : ""}`;
    }
    default: return list.map(String).join(", ");
  }
}

type Props = {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown, opts?: ChangeOptions) => void;
  onBlur?: () => void;
  error?: string;
  required: boolean;
  disabled: boolean;
  mode: "internal" | "external";
  team?: TeamOption[];
  /** Answers used to render merge tags in content fields. */
  answers: Record<string, unknown>;
  labels: Record<string, Record<string, string>>;
  /** Names of files uploaded in this browser session, by document id. */
  fileNames: Record<string, string>;
  fileUrls?: Record<string, string | null>;
  onUpload: (fieldKey: string, file: File) => Promise<FileUploadResult>;
};

/**
 * One field of a form section. Every control carries the field label as its accessible name.
 * The wrapper has the id field-<key> so a summary link can jump to it.
 */
export function FieldInput(props: Props) {
  const { field } = props;
  const uid = useId();
  const id = `${uid}-input`;
  const helpId = field.help ? `${uid}-help` : undefined;
  const errId = props.error ? `${uid}-error` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(" ") || undefined;

  if (field.type === "content") {
    const body = renderMergeTags(field.options.body ?? "", props.answers, { labels: props.labels, escapeHtml: false });
    return (
      <div id={`field-${field.key}`} className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-fg-2 whitespace-pre-wrap">
        {body || field.label}
      </div>
    );
  }

  const group = field.type === "multiple_choice" || field.type === "yes_no" || (field.type === "single_choice" && field.options.display === "radio") || (field.type === "person" && field.options.multiple);
  const marker = props.required ? <span aria-hidden="true" className="ml-0.5 text-bad">*</span> : null;

  return (
    <div id={`field-${field.key}`} className="min-w-0 scroll-mt-20">
      {group ? (
        <fieldset aria-describedby={describedBy} aria-invalid={props.error ? true : undefined} aria-required={props.required || undefined} className="min-w-0">
          <legend className="block text-xs font-medium text-fg-2 mb-1">{field.label}{marker}</legend>
          {helpId ? <p id={helpId} className="text-xs text-fg-3 mb-1">{field.help}</p> : null}
          <GroupControl {...props} baseId={id} />
        </fieldset>
      ) : (
        <>
          <label htmlFor={id} className="block text-xs font-medium text-fg-2 mb-1">{field.label}{marker}</label>
          {helpId ? <p id={helpId} className="text-xs text-fg-3 mb-1">{field.help}</p> : null}
          <SingleControl {...props} id={id} describedBy={describedBy} />
        </>
      )}
      {props.error ? <p id={errId} role="alert" className="mt-1 text-xs text-bad">{props.error}</p> : null}
    </div>
  );
}

function SingleControl({ field, value, onChange, onBlur, error, required, disabled, mode, team = [], fileNames, fileUrls, onUpload, id, describedBy }: Props & { id: string; describedBy?: string }) {
  const o = field.options;
  const common = { id, disabled, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "aria-required": required || undefined, onBlur } as const;
  const text = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  switch (field.type) {
    case "short_text": return <Input {...common} type={o.pattern === "email" ? "email" : o.pattern === "url" ? "url" : o.pattern === "phone" ? "tel" : "text"} value={text} placeholder={o.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "long_text": return <Textarea {...common} value={text} placeholder={o.placeholder} rows={4} onChange={(e) => onChange(e.target.value)} />;
    case "number": return <NumberInput {...common} value={value} unit={o.unit} currency={o.currency} placeholder={o.placeholder} onChange={onChange} />;
    case "date":
      return o.withTime
        ? <Input {...common} type="datetime-local" value={text.slice(0, 16)} onChange={(e) => onChange(e.target.value, { immediate: true })} />
        : <Input {...common} type="date" value={text.slice(0, 10)} onChange={(e) => onChange(e.target.value, { immediate: true })} />;
    case "single_choice": return <SingleChoiceSelect {...common} field={field} value={value} onChange={onChange} />;
    case "person": {
      if (mode === "external") return <p id={id} className="text-[13px] text-fg-2">{value ? "A team member is selected." : "Not selected."}</p>;
      return (
        <Select {...common} value={text} onChange={(e) => onChange(e.target.value, { immediate: true })}>
          <option value="">Choose a person</option>
          {team.filter((t) => !field.options.limitToRole || !t.role || t.role === field.options.limitToRole || t.id === text).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      );
    }
    case "file_upload": return <FileControl {...common} field={field} value={value} onChange={onChange} fileNames={fileNames} fileUrls={fileUrls} onUpload={onUpload} />;
    default: return <Input {...common} value={text} onChange={(e) => onChange(e.target.value)} />;
  }
}

function NumberInput({ value, onChange, unit, currency, ...rest }: { value: unknown; onChange: (v: unknown, o?: ChangeOptions) => void; unit?: string; currency?: boolean; placeholder?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [raw, setRaw] = useState(value === null || value === undefined ? "" : String(value));
  const last = useRef(value);
  // Take a new value from outside (a rule set it) without disturbing what is being typed.
  useEffect(() => {
    if (value !== last.current && Number(raw) !== value) setRaw(value === null || value === undefined ? "" : String(value));
    last.current = value;
  }, [value, raw]);
  return (
    <div className="flex items-center gap-2">
      {currency ? <span className="text-[13px] text-fg-3" aria-hidden="true">$</span> : null}
      <Input {...rest} type="text" inputMode="decimal" className="num text-right" value={raw} onChange={(e) => {
        const next = e.target.value;
        setRaw(next);
        const cleaned = next.replace(/[,\s]/g, "");
        const n = Number(cleaned);
        last.current = cleaned === "" ? null : Number.isFinite(n) ? n : next;
        onChange(cleaned === "" ? null : Number.isFinite(n) ? n : next);
      }} />
      {unit ? <span className="text-[13px] text-fg-3" aria-hidden="true">{unit}</span> : null}
    </div>
  );
}

function SingleChoiceSelect({ field, value, onChange, ...rest }: { field: FieldDef; value: unknown; onChange: (v: unknown, o?: ChangeOptions) => void } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  const o = field.options;
  const choices = o.choices ?? [];
  const current = typeof value === "string" ? value : "";
  const isOther = o.allowOther === true && current !== "" && !choices.some((c) => c.value === current);
  const [otherOn, setOtherOn] = useState(isOther);
  const showOther = otherOn || isOther;
  return (
    <div className="space-y-2">
      <Select {...rest} value={showOther ? "__other__" : current} onChange={(e) => {
        if (e.target.value === "__other__") { setOtherOn(true); onChange("", { immediate: false }); }
        else { setOtherOn(false); onChange(e.target.value, { immediate: true }); }
      }}>
        <option value="">Choose one</option>
        {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        {o.allowOther ? <option value="__other__">Other</option> : null}
      </Select>
      {showOther ? <Input aria-label={`${field.label}, other`} disabled={rest.disabled} value={isOther ? current : ""} placeholder="Describe" onBlur={rest.onBlur as unknown as React.FocusEventHandler<HTMLInputElement>} onChange={(e) => onChange(e.target.value)} /> : null}
    </div>
  );
}

function FileControl({ field, value, onChange, fileNames, fileUrls, onUpload, disabled, ...rest }: { field: FieldDef; value: unknown; onChange: (v: unknown, o?: ChangeOptions) => void; fileNames: Record<string, string>; fileUrls?: Record<string, string | null>; onUpload: Props["onUpload"] } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const ids = asList(value).filter((v): v is string => typeof v === "string");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const o = field.options;
  const full = o.maxFiles !== undefined && ids.length >= o.maxFiles;
  const accept = o.allowedTypes && o.allowedTypes.length ? o.allowedTypes.join(",") : undefined;
  async function pick(files: FileList | null) {
    if (!files || files.length === 0 || busy) return;
    setBusy(true); setErr(null);
    try {
      for (const file of Array.from(files)) {
        const limit = Math.min(o.maxSizeMb ?? 25, 25) * 1024 * 1024;
        if (file.size > limit) { setErr(`${file.name} is larger than ${Math.round(limit / 1024 / 1024)} MB.`); continue; }
        const res = await onUpload(field.key, file);
        if (!res.ok) setErr(`${file.name}: ${res.error ?? "the upload failed."}`);
      }
    } catch {
      setErr("The upload failed. The file may be larger than the server accepts.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="space-y-2">
      <input {...rest} ref={input} type="file" multiple={o.maxFiles === undefined || o.maxFiles > 1} accept={accept} disabled={disabled || busy || full}
        onChange={(e) => void pick(e.target.files)} className="block w-full text-[13px] text-fg-2 file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-2.5 file:py-1 file:text-xs" />
      {busy ? <p role="status" className="text-xs text-fg-3">Uploading</p> : null}
      {err ? <p role="alert" className="text-xs text-bad">{err}</p> : null}
      {ids.length ? (
        <ul className="text-[13px] space-y-1" aria-label={`${field.label}, attached files`}>
          {ids.map((fid, i) => (
            <li key={fid} className="flex items-center justify-between gap-2">
              {fileUrls?.[fid] ? <a href={fileUrls[fid]!} target="_blank" rel="noreferrer" className="truncate min-w-0 underline">{fileNames[fid] ?? `File ${i + 1}`}</a> : <span className="truncate min-w-0">{fileNames[fid] ?? `File ${i + 1}`}</span>}
              {!disabled ? <Button type="button" variant="ghost" size="sm" className="text-fg-3" aria-label={`Remove ${fileNames[fid] ?? `file ${i + 1}`}`} onClick={() => onChange(ids.filter((x) => x !== fid), { immediate: true })}>Remove</Button> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function GroupControl({ field, value, onChange, onBlur, disabled, team = [], baseId }: Props & { baseId: string }) {
  const o = field.options;
  const radio = (opts: { value: string; label: string }[], current: string | null, name: string, set: (v: string) => void) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1" role="radiogroup" aria-label={field.label}>
      {opts.map((c) => (
        <label key={c.value} className="flex items-center gap-2 text-[13px]">
          <input type="radio" name={name} value={c.value} checked={current === c.value} disabled={disabled} onBlur={onBlur} onChange={() => set(c.value)} className="h-4 w-4" />
          {c.label}
        </label>
      ))}
    </div>
  );
  if (field.type === "yes_no") {
    const yes = o.yesLabel || "Yes";
    const no = o.noLabel || "No";
    return radio([{ value: "yes", label: yes }, { value: "no", label: no }], value === true ? "yes" : value === false ? "no" : null, baseId, (v) => onChange(v === "yes", { immediate: true }));
  }
  if (field.type === "single_choice") {
    return radio(o.choices ?? [], typeof value === "string" ? value : null, baseId, (v) => onChange(v, { immediate: true }));
  }
  if (field.type === "person") {
    const ids = asList(value).filter((v): v is string => typeof v === "string");
    return (
      <div className="flex flex-col gap-1">
        {team.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={ids.includes(t.id)} disabled={disabled} onBlur={onBlur} onChange={(e) => onChange(e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id), { immediate: true })} className="h-4 w-4" />
            {t.name}
          </label>
        ))}
      </div>
    );
  }
  // multiple_choice
  const choices = o.choices ?? [];
  const selected = asList(value).filter((v): v is string => typeof v === "string");
  const other = selected.find((v) => !choices.some((c) => c.value === v)) ?? "";
  return (
    <div className="flex flex-col gap-1">
      {choices.map((c) => (
        <label key={c.value} className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={selected.includes(c.value)} disabled={disabled} onBlur={onBlur}
            onChange={(e) => onChange(e.target.checked ? [...selected, c.value] : selected.filter((x) => x !== c.value), { immediate: true })} className="h-4 w-4" />
          {c.label}
        </label>
      ))}
      {o.allowOther ? (
        <Input aria-label={`${field.label}, other`} disabled={disabled} value={other} placeholder="Other" onBlur={onBlur}
          onChange={(e) => {
            const rest = selected.filter((x) => choices.some((c) => c.value === x));
            onChange(e.target.value.trim() ? [...rest, e.target.value] : rest);
          }} className={cn("mt-1 max-w-xs")} />
      ) : null}
    </div>
  );
}
