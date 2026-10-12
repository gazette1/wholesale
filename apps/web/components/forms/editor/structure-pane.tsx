"use client";
import * as React from "react";
import { sortByOrder, type FormDefinition } from "@dealcalc/forms";
import { ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FIELD_TYPE_LABELS } from "./model";
import { usePointerDrag, type DragItem, type DropTarget } from "./use-pointer-drag";

export type Selection = { kind: "section" | "field"; key: string } | null;

export function StructurePane({ def, selected, onSelect, onAddSection, onAddField, onMoveSection, onMoveField, onDrop, errorSections }: {
  def: FormDefinition;
  selected: Selection;
  onSelect: (s: Selection) => void;
  onAddSection: () => void;
  onAddField: (sectionKey: string) => void;
  onMoveSection: (key: string, delta: -1 | 1) => void;
  onMoveField: (key: string, delta: -1 | 1) => void;
  onDrop: (item: DragItem, target: DropTarget) => void;
  errorSections: Set<string>;
}) {
  const { drag, handleProps } = usePointerDrag(onDrop);
  const sections = sortByOrder(def.sections);
  const roleLabel = (key: string) => def.roles.find((r) => r.key === key)?.label ?? key;

  const indicator = (kind: "section" | "field", id: string) => {
    const t = drag?.target;
    if (!t || t.kind !== kind || t.id !== id) return "";
    return t.after ? "border-b-2 border-b-brand" : "border-t-2 border-t-brand";
  };

  return (
    <div className="space-y-2" aria-label="Form structure">
      {sections.length === 0 ? <p className="text-[13px] text-fg-3 py-4">This form has no sections yet. Add the first section to start.</p> : null}
      {sections.map((s, si) => {
        const fields = sortByOrder(s.fields);
        const secSelected = selected?.kind === "section" && selected.key === s.key;
        const draggingField = drag?.item.kind === "field";
        const fieldDropHere = draggingField && drag?.target?.kind === "section" && drag.target.id === s.key;
        return (
          <div key={s.key} data-drop={`section:${s.key}`} className={cn("rounded-lg border bg-surface", secSelected ? "border-brand" : "border-border", drag?.item.kind === "section" && drag.item.id === s.key && "opacity-50", indicator("section", s.key), fieldDropHere && "ring-2 ring-brand/40")}>
            <div className="flex items-center gap-1 px-2 py-2 border-b border-border/70">
              <span role="img" aria-label={`Drag section ${s.title}`} className="p-1 text-fg-3 hover:text-fg rounded touch-none" {...handleProps({ kind: "section", id: s.key })}><GripVertical className="h-4 w-4" /></span>
              <button type="button" onClick={() => onSelect({ kind: "section", key: s.key })} className="flex-1 min-w-0 text-left" aria-label={`Edit section ${s.title}`} aria-pressed={secSelected}>
                <div className="text-[13px] font-semibold truncate">{si + 1}. {s.title}</div>
                <div className="text-[11px] text-fg-3 truncate">Owner: {roleLabel(s.ownerRole)}{s.needsApproval ? " · approval" : ""}{s.parallelGroup ? ` · parallel ${s.parallelGroup}` : ""}</div>
              </button>
              {errorSections.has(s.key) ? <Badge tone="bad">Needs fixing</Badge> : null}
              <Button type="button" size="iconSm" variant="ghost" aria-label={`Move up ${s.title}`} title="Move up" disabled={si === 0} onClick={() => onMoveSection(s.key, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button type="button" size="iconSm" variant="ghost" aria-label={`Move down ${s.title}`} title="Move down" disabled={si === sections.length - 1} onClick={() => onMoveSection(s.key, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
            </div>
            <ul className="px-2 py-1.5 space-y-1">
              {fields.map((f, fi) => {
                const fSelected = selected?.kind === "field" && selected.key === f.key;
                return (
                  <li key={f.key} data-drop={`field:${f.key}`} className={cn("flex items-center gap-1 rounded-md border px-1.5 py-1", fSelected ? "border-brand bg-brand-soft/40" : "border-border/70", drag?.item.kind === "field" && drag.item.id === f.key && "opacity-50", indicator("field", f.key))}>
                    <span role="img" aria-label={`Drag field ${f.label}`} className="p-0.5 text-fg-3 hover:text-fg rounded touch-none" {...handleProps({ kind: "field", id: f.key })}><GripVertical className="h-3.5 w-3.5" /></span>
                    <button type="button" onClick={() => onSelect({ kind: "field", key: f.key })} className="flex-1 min-w-0 text-left" aria-label={`Edit field ${f.label}`} aria-pressed={fSelected}>
                      <div className="text-[13px] truncate">{f.label}{f.required ? <span className="text-bad"> *</span> : null}</div>
                      <div className="text-[11px] text-fg-3 truncate">{FIELD_TYPE_LABELS[f.type as keyof typeof FIELD_TYPE_LABELS] ?? f.type} · {f.key}</div>
                    </button>
                    <Button type="button" size="iconSm" variant="ghost" aria-label={`Move up ${f.label}`} title="Move up" disabled={fi === 0} onClick={() => onMoveField(f.key, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button type="button" size="iconSm" variant="ghost" aria-label={`Move down ${f.label}`} title="Move down" disabled={fi === fields.length - 1} onClick={() => onMoveField(f.key, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                  </li>
                );
              })}
              {fields.length === 0 ? <li className="text-xs text-fg-3 px-1 py-1">No fields in this section.</li> : null}
            </ul>
            <div className="px-2 pb-2">
              <Button type="button" size="sm" variant="outline" onClick={() => onAddField(s.key)} aria-label={`Add field to ${s.title}`}><Plus className="h-3.5 w-3.5" />Add field</Button>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" onClick={onAddSection}><Plus className="h-4 w-4" />Add section</Button>
    </div>
  );
}
