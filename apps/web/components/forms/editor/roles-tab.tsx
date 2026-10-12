"use client";
import * as React from "react";
import { APP_ROLES, type FormDefinition, type RoleDef, type RoleSource } from "@dealcalc/forms";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ROLE_LABELS } from "./model";

export type ProfileOption = { id: string; name: string };

const SOURCE_LABELS: Record<RoleSource["kind"], string> = {
  person_field: "A person field in the form", subject_owner: "The owner of the lead or buyer", starter: "The person who started the form",
  role_group: "Anyone with an app role", fixed_profile: "A fixed team member", external: "An external person by invite",
};

function defaultSource(kind: RoleSource["kind"], def: FormDefinition, profiles: ProfileOption[]): RoleSource {
  switch (kind) {
    case "person_field": return { kind, fieldKey: def.sections.flatMap((s) => s.fields).find((f) => f.type === "person")?.key ?? "" };
    case "role_group": return { kind, role: "acquisitions" };
    case "fixed_profile": return { kind, profileId: profiles[0]?.id ?? "" };
    case "subject_owner": return { kind };
    case "starter": return { kind };
    case "external": return { kind };
  }
}

function SourceRow({ src, index, count, role, def, profiles, onChange, onMove, onRemove }: {
  src: RoleSource; index: number; count: number; role: RoleDef; def: FormDefinition; profiles: ProfileOption[];
  onChange: (s: RoleSource) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const personFields = def.sections.flatMap((s) => s.fields.filter((f) => f.type === "person"));
  const base = `${role.label} source ${index + 1}`;
  return (
    <div className="flex flex-wrap items-end gap-1.5 rounded-md border border-border/70 p-2">
      <span className="text-xs text-fg-3 w-5 pb-2">{index + 1}.</span>
      <Field label={`${base} kind`} className="w-56">
        <Select value={src.kind} onChange={(e) => onChange(defaultSource(e.target.value as RoleSource["kind"], def, profiles))}>
          {(Object.keys(SOURCE_LABELS) as RoleSource["kind"][]).map((k) => <option key={k} value={k}>{SOURCE_LABELS[k]}</option>)}
        </Select>
      </Field>
      {src.kind === "person_field" ? (
        <Field label={`${base} person field`} className="w-48">
          <Select value={src.fieldKey} onChange={(e) => onChange({ kind: "person_field", fieldKey: e.target.value })}>
            <option value="">Choose a person field</option>
            {personFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </Select>
        </Field>
      ) : null}
      {src.kind === "role_group" ? (
        <Field label={`${base} app role`} className="w-40">
          <Select value={src.role} onChange={(e) => onChange({ kind: "role_group", role: e.target.value as (typeof APP_ROLES)[number] })}>
            {APP_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>
      ) : null}
      {src.kind === "fixed_profile" ? (
        <Field label={`${base} team member`} className="w-48">
          <Select value={src.profileId} onChange={(e) => onChange({ kind: "fixed_profile", profileId: e.target.value })}>
            <option value="">Choose a team member</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      ) : null}
      <div className="flex gap-0.5 pb-0.5">
        <Button type="button" size="iconSm" variant="ghost" aria-label={`Move up ${base}`} title="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
        <Button type="button" size="iconSm" variant="ghost" aria-label={`Move down ${base}`} title="Move down" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
        <Button type="button" size="iconSm" variant="ghost" aria-label={`Remove ${base}`} disabled={count === 1} onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

export function RolesTab({ def, profiles, onChangeRole, onAddRole, onDeleteRole }: {
  def: FormDefinition; profiles: ProfileOption[];
  onChangeRole: (key: string, patch: Partial<RoleDef>) => void;
  onAddRole: (label: string) => void;
  onDeleteRole: (key: string) => void;
}) {
  const [newLabel, setNewLabel] = React.useState("");
  return (
    <div className="space-y-4" aria-label="Roles">
      <p className="text-[13px] text-fg-2">A role stands for the person who does a section. The sources are tried in order and the first one that finds someone is used.</p>
      {def.roles.map((r) => {
        const usedBy = def.sections.filter((s) => s.ownerRole === r.key).length;
        const setSources = (resolution: RoleSource[]) => onChangeRole(r.key, { resolution });
        return (
          <div key={r.key} className="rounded-lg border border-border bg-surface p-3 space-y-2">
            <div className="flex items-end gap-2">
              <Field label={`Role name for ${r.key}`} className="flex-1"><Input value={r.label} onChange={(e) => onChangeRole(r.key, { label: e.target.value })} /></Field>
              <span className="text-xs text-fg-3 pb-2">Key: <code>{r.key}</code></span>
              <Button type="button" variant="ghost" size="sm" disabled={usedBy > 0} title={usedBy > 0 ? `Used by ${usedBy} section${usedBy === 1 ? "" : "s"}` : "Delete role"} aria-label={`Delete role ${r.label}`} onClick={() => onDeleteRole(r.key)}><Trash2 className="h-3.5 w-3.5" />Delete</Button>
            </div>
            <div className="space-y-1.5">
              {r.resolution.map((src, i) => (
                <SourceRow key={i} src={src} index={i} count={r.resolution.length} role={r} def={def} profiles={profiles}
                  onChange={(s) => setSources(r.resolution.map((x, j) => (j === i ? s : x)))}
                  onMove={(d) => { const next = [...r.resolution]; const [m] = next.splice(i, 1); next.splice(i + d, 0, m!); setSources(next); }}
                  onRemove={() => setSources(r.resolution.filter((_, j) => j !== i))} />
              ))}
            </div>
            <Button type="button" size="sm" variant="outline" aria-label={`Add source to ${r.label}`} onClick={() => setSources([...r.resolution, defaultSource("starter", def, profiles)])}><Plus className="h-3.5 w-3.5" />Add source</Button>
          </div>
        );
      })}
      <div className="flex items-end gap-2">
        <Field label="New role name" className="w-64"><Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="For example Manager" /></Field>
        <Button type="button" variant="outline" disabled={!newLabel.trim()} onClick={() => { onAddRole(newLabel.trim()); setNewLabel(""); }}><Plus className="h-4 w-4" />Add role</Button>
      </div>
    </div>
  );
}
