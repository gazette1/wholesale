"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { parseDefinition, validateDefinition, sortByOrder, type DefinitionError, type FieldOptions, type FieldType, type FormDefinition } from "@dealcalc/forms";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { publishFormAction, saveFormDraftDefinition } from "@/lib/actions/forms";
import type { FormStatus, FormVersionRow } from "@/lib/forms/types";
import {
  addField, addRole, addSection, applyDrop, defaultOptionsFor, deleteField, deleteSection, emptyDefinition, findFieldLocation, allFieldKeys,
  moveFieldBy, moveSectionBy, pathKey, renameFieldKey, updateField, updateSection,
} from "./model";
import { StructurePane, type Selection } from "./structure-pane";
import { SectionPanel } from "./section-panel";
import { FieldPanel } from "./field-panel";
import { RolesTab, type ProfileOption } from "./roles-tab";
import { RulesTab } from "./rules-tab";
import { PreviewTab } from "./preview-tab";
import { SettingsTab, type DetailsValue } from "./settings-tab";
import { ValidationPanel } from "./validation-panel";
import type { DragItem, DropTarget } from "./use-pointer-drag";

type Tab = "form" | "roles" | "rules" | "preview" | "settings" | "versions";
const TABS: { key: Tab; label: string }[] = [
  { key: "form", label: "Form" }, { key: "roles", label: "Roles" }, { key: "rules", label: "Rules" },
  { key: "preview", label: "Preview" }, { key: "settings", label: "Settings" }, { key: "versions", label: "Versions" },
];
type SaveState = "saved" | "dirty" | "saving" | "error";

function cleanOptions(o: FieldOptions): FieldOptions {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as FieldOptions;
}

export type EditorProps = {
  formId: string;
  status: FormStatus;
  latestVersionNumber: number | null;
  versions: FormVersionRow[];
  draftDefinition: unknown;
  publishedDefinition?: unknown;
  details: DetailsValue;
  profiles: ProfileOption[];
};

export function FormEditor(props: EditorProps) {
  const { formId, versions, profiles } = props;
  const router = useRouter();
  const initial = React.useMemo(() => {
    try { return { def: parseDefinition(props.draftDefinition ?? {}), warning: null as string | null }; } catch {
      return { def: emptyDefinition(), warning: "The saved draft could not be read, so the editor started from an empty form. Saving will replace the saved draft." };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [def, setDef] = React.useState<FormDefinition>(initial.def);
  const defRef = React.useRef(def);
  const revRef = React.useRef(0);
  const [rev, setRev] = React.useState(0);
  const [tab, setTab] = React.useState<Tab>("form");
  const [selected, setSelected] = React.useState<Selection>(() => {
    const first = sortByOrder(initial.def.sections)[0];
    return first ? { kind: "section", key: first.key } : null;
  });
  const [saveState, setSaveState] = React.useState<SaveState>("saved");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [serverErrors, setServerErrors] = React.useState<DefinitionError[]>([]);
  const [details, setDetails] = React.useState<DetailsValue>(props.details);
  const [publishing, setPublishing] = React.useState(false);
  const [publishResult, setPublishResult] = React.useState<{ ok: boolean; message: string; errors?: DefinitionError[] } | null>(null);
  // Keys present when the form was loaded are treated as published when a version exists.
  const [lockedKeys, setLockedKeys] = React.useState<Set<string>>(() => { try { return props.publishedDefinition ? allFieldKeys(parseDefinition(props.publishedDefinition)) : new Set(); } catch { return props.latestVersionNumber !== null ? allFieldKeys(initial.def) : new Set(); } });
  const saving = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = React.useCallback((next: FormDefinition) => {
    defRef.current = next;
    setDef(next);
    revRef.current += 1;
    setRev(revRef.current);
    setSaveState((s) => (s === "saving" ? s : "dirty"));
    setPublishResult(null);
  }, []);

  const saveNow = React.useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    while (saving.current) await new Promise((r) => setTimeout(r, 100));
    saving.current = true;
    setSaveState("saving");
    const startedAt = revRef.current;
    try {
      const res = await saveFormDraftDefinition(formId, defRef.current);
      if (!res.ok) { setSaveState("error"); setSaveError(res.error); return false; }
      setServerErrors(res.errors ?? []);
      setSaveError(null);
      setSaveState(revRef.current === startedAt ? "saved" : "dirty");
      return true;
    } catch {
      setSaveState("error");
      setSaveError("Could not save the draft. Check your connection and try again.");
      return false;
    } finally {
      saving.current = false;
    }
  }, [formId]);

  React.useEffect(() => {
    if (rev === 0) return;
    timer.current = setTimeout(() => { void saveNow(); }, 3000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [rev, saveNow]);

  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (saveState === "dirty" || saveState === "saving") { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  const validation = React.useMemo(() => validateDefinition(def), [def]);
  const allErrors = React.useMemo(() => {
    const seen = new Set(validation.errors.map((e) => `${e.path}|${e.message}`));
    return [...validation.errors, ...serverErrors.filter((e) => !seen.has(`${e.path}|${e.message}`))];
  }, [validation, serverErrors]);
  const errorSections = React.useMemo(() => {
    const out = new Set<string>();
    for (const e of allErrors) { const p = pathKey(e.path); if (p.section !== undefined && def.sections[p.section]) out.add(def.sections[p.section]!.key); }
    return out;
  }, [allErrors, def.sections]);
  const ruleErrors = React.useMemo(() => {
    const m = new Map<number, string[]>();
    for (const e of allErrors) { const p = pathKey(e.path); if (p.rule !== undefined) m.set(p.rule, [...(m.get(p.rule) ?? []), e.message]); }
    return m;
  }, [allErrors]);

  const jump = (path: string) => {
    const p = pathKey(path);
    if (p.rule !== undefined || path === "rules") { setTab("rules"); return; }
    if (path.startsWith("roles")) { setTab("roles"); return; }
    const s = p.section !== undefined ? def.sections[p.section] : undefined;
    if (!s) return;
    setTab("form");
    const f = p.field !== undefined ? s.fields[p.field] : undefined;
    setSelected(f ? { kind: "field", key: f.key } : { kind: "section", key: s.key });
  };

  /* ------------------------------ editing ------------------------------ */

  const addNewSection = () => { const r = addSection(defRef.current); commit(r.def); setSelected({ kind: "section", key: r.key }); };
  const addNewField = (sectionKey: string) => { const r = addField(defRef.current, sectionKey); commit(r.def); if (r.key) setSelected({ kind: "field", key: r.key }); };
  const onDrop = (item: DragItem, target: DropTarget) => commit(applyDrop(defRef.current, item, target));

  const selectedSection = selected?.kind === "section" ? def.sections.find((s) => s.key === selected.key) : undefined;
  const selectedField = selected?.kind === "field" ? findFieldLocation(def, selected.key)?.field : undefined;

  const publish = async () => {
    setPublishResult(null);
    const v = validateDefinition(defRef.current);
    if (!v.ok) { setPublishResult({ ok: false, message: "Fix the problems listed below before publishing.", errors: v.errors }); return; }
    if (defRef.current.sections.length === 0) { setPublishResult({ ok: false, message: "Add at least one section before publishing." }); return; }
    setPublishing(true);
    try {
      const saved = await saveNow();
      if (!saved) { setPublishResult({ ok: false, message: "The draft could not be saved, so nothing was published." }); return; }
      const res = await publishFormAction(formId);
      if (!res.ok) { setPublishResult({ ok: false, message: res.error, errors: res.errors }); return; }
      setLockedKeys(allFieldKeys(defRef.current));
      setPublishResult({ ok: true, message: `Published version ${res.versionNumber}. ${res.migrated ?? 0} ${res.migrated === 1 ? "submission was" : "submissions were"} migrated to it.` });
      router.refresh();
    } catch {
      setPublishResult({ ok: false, message: "Could not publish. Try again." });
    } finally {
      setPublishing(false);
    }
  };

  const saveLabel = saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving" : saveState === "dirty" ? "Unsaved changes" : "Not saved";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold truncate">{details.name}</h2>
          <Badge tone={props.status === "published" ? "good" : "neutral"}>{props.status === "published" ? `Published v${props.latestVersionNumber}` : "Draft"}</Badge>
          <span role="status" aria-live="polite" className={cn("text-xs", saveState === "error" ? "text-bad" : "text-fg-3")}>{saveLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <LinkButton href={`/forms/${formId}/submissions`} variant="outline" size="sm">Submissions</LinkButton>
          <Button type="button" variant="outline" onClick={() => { void saveNow(); }} loading={saveState === "saving"}>Save</Button>
          <Button type="button" variant="primary" onClick={publish} loading={publishing}>Publish</Button>
        </div>
      </div>

      {initial.warning ? <Alert tone="warn">{initial.warning}</Alert> : null}
      {saveError ? <Alert tone="bad">{saveError}</Alert> : null}
      {publishResult ? (
        <Alert tone={publishResult.ok ? "good" : "bad"}>
          {publishResult.message}
          {publishResult.errors?.length ? (
            <ul className="mt-1 list-disc pl-5 space-y-0.5">
              {publishResult.errors.map((e, i) => <li key={i}>{e.message} <span className="font-mono text-[11px] opacity-80">({e.path || "form"})</span></li>)}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <div role="tablist" aria-label="Editor sections" className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`panel-${t.key}`} onClick={() => setTab(t.key)}
            className={cn("px-3 py-2 text-[13px] whitespace-nowrap border-b-2 -mb-px", tab === t.key ? "border-fg text-fg font-medium" : "border-transparent text-fg-3 hover:text-fg")}>
            {t.label}{t.key === "rules" && def.rules.length ? <span className="ml-1.5 rounded-full bg-black/5 px-1.5 text-[11px] text-fg-3">{def.rules.length}</span> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "form" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(300px,420px)_1fr]">
            <StructurePane def={def} selected={selected} onSelect={setSelected} onAddSection={addNewSection} onAddField={addNewField}
              onMoveSection={(k, d) => commit(moveSectionBy(defRef.current, k, d))} onMoveField={(k, d) => commit(moveFieldBy(defRef.current, k, d))}
              onDrop={onDrop} errorSections={errorSections} />
            <aside className="rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto" aria-label="Side panel">
              {selectedSection ? (
                <SectionPanel section={selectedSection} def={def} onChange={(patch) => commit(updateSection(defRef.current, selectedSection.key, patch))}
                  onDelete={() => { commit(deleteSection(defRef.current, selectedSection.key)); setSelected(null); }} />
              ) : selectedField ? (
                <FieldPanel field={selectedField} def={def} keyLocked={lockedKeys.has(selectedField.key)}
                  takenKeys={(() => { const k = allFieldKeys(def); k.delete(selectedField.key); return k; })()}
                  onChange={(patch) => commit(updateField(defRef.current, selectedField.key, patch))}
                  onOptions={(patch) => { const loc = findFieldLocation(defRef.current, selectedField.key); if (loc) commit(updateField(defRef.current, selectedField.key, { options: cleanOptions({ ...loc.field.options, ...patch }) })); }}
                  onRenameKey={(next) => { commit(renameFieldKey(defRef.current, selectedField.key, next)); setSelected({ kind: "field", key: next }); }}
                  onChangeType={(t: FieldType) => commit(updateField(defRef.current, selectedField.key, { type: t, options: defaultOptionsFor(t), default: undefined }))}
                  onDelete={() => { commit(deleteField(defRef.current, selectedField.key)); setSelected(null); }} />
              ) : (
                <p className="text-[13px] text-fg-3">Select a section or a field to edit its settings.</p>
              )}
            </aside>
          </div>
        ) : null}

        {tab === "roles" ? (
          <RolesTab def={def} profiles={profiles}
            onChangeRole={(key, patch) => commit({ ...defRef.current, roles: defRef.current.roles.map((r) => (r.key === key ? { ...r, ...patch } : r)) })}
            onAddRole={(label) => commit(addRole(defRef.current, label).def)}
            onDeleteRole={(key) => commit({ ...defRef.current, roles: defRef.current.roles.filter((r) => r.key !== key) })} />
        ) : null}

        {tab === "rules" ? <RulesTab def={def} ruleErrors={ruleErrors} onChange={(rules) => commit({ ...defRef.current, rules })} /> : null}

        {tab === "preview" ? <PreviewTab def={def} timeZone={details.settings.timeZone} versionNumber={props.latestVersionNumber} /> : null}

        {tab === "settings" ? (
          <SettingsTab formId={formId} details={details} profiles={profiles} published={props.latestVersionNumber !== null} onSaved={setDetails} />
        ) : null}

        {tab === "versions" ? (
          <div className="space-y-2 max-w-xl" aria-label="Version history">
            {versions.length === 0 ? <p className="text-[13px] text-fg-3">This form has not been published yet.</p> : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
                    <span className="font-medium">Version {v.number}{v.number === props.latestVersionNumber ? <Badge tone="good" className="ml-2">Current</Badge> : null}</span>
                    <span className="text-fg-3 text-xs">{new Date(v.publishedAt).toLocaleString()}{v.publishedByName ? ` by ${v.publishedByName}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-fg-3">Every submission follows the latest version. Publishing a new version moves open and completed submissions to it.</p>
          </div>
        ) : null}
      </div>

      <ValidationPanel errors={allErrors} onJump={jump} />
    </div>
  );
}

