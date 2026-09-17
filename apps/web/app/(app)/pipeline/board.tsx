"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { moveLeadStage } from "@/lib/actions/leads";
import { cn, money, dueLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Flame } from "lucide-react";

export type BoardLead = { id: string; stageId: string; address: string; city: string; contact: string; assigned: string | null; attempts: number; nextFollowUpAt: string | null; askingPrice: number | null; urgency: string; messy: number; source: string | null; tags: { name: string; color: string | null; kind: string }[] };
export type BoardStage = { id: string; key: string; name: string; color: string | null; isTerminal: boolean };

export function Board({ stages, leads, canMove }: { stages: BoardStage[]; leads: BoardLead[]; canMove: boolean }) {
  const [items, setItems] = useState(leads);
  const [active, setActive] = useState<BoardLead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const byStage = useMemo(() => {
    const map = new Map<string, BoardLead[]>();
    for (const s of stages) map.set(s.id, []);
    for (const l of items) map.get(l.stageId)?.push(l);
    return map;
  }, [items, stages]);

  function onDragStart(e: DragStartEvent) { setActive(items.find((l) => l.id === e.active.id) ?? null); }
  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const leadId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    const lead = items.find((l) => l.id === leadId);
    if (!lead || lead.stageId === stageId) return;
    const previous = lead.stageId;
    setItems((prev) => prev.map((l) => (l.id === leadId ? { ...l, stageId } : l)));
    startTransition(async () => {
      const res = await moveLeadStage(leadId, stageId);
      if (!res.ok) { setError(res.error); setItems((prev) => prev.map((l) => (l.id === leadId ? { ...l, stageId: previous } : l))); }
    });
  }

  return (
    <>
      {error ? <div className="mb-3 rounded-md border border-[#f3c0c0] bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div> : null}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin -mx-1 px-1 min-h-[70vh] snap-x">
          {stages.map((s) => <Column key={s.id} stage={s} leads={byStage.get(s.id) ?? []} canMove={canMove} />)}
        </div>
        <DragOverlay>{active ? <LeadCard lead={active} dragging /> : null}</DragOverlay>
      </DndContext>
    </>
  );
}

function Column({ stage, leads, canMove }: { stage: BoardStage; leads: BoardLead[]; canMove: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled: !canMove });
  const total = leads.reduce((a, l) => a + (l.askingPrice ?? 0), 0);
  return (
    <div ref={setNodeRef} className={cn("flex w-[272px] shrink-0 flex-col rounded-lg border bg-surface-2/70 snap-start transition-colors", isOver ? "border-brand bg-brand-soft/40" : "border-border")}>
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: stage.color ?? "#9ca3af" }} />
          <span className="text-[13px] font-semibold truncate">{stage.name}</span>
          <span className="text-xs text-fg-3 num">{leads.length}</span>
        </div>
        {total > 0 ? <span className="text-[11px] text-fg-3 num">{money(total)}</span> : null}
      </div>
      <div className="flex flex-col gap-2 px-2 pb-2 overflow-y-auto max-h-[calc(100vh-220px)] scrollbar-thin">
        {leads.map((l) => <DraggableCard key={l.id} lead={l} disabled={!canMove} />)}
        {leads.length === 0 ? <div className="text-[11px] text-fg-3 text-center py-6 border border-dashed border-border rounded-md">Drop leads here</div> : null}
      </div>
    </div>
  );
}

function DraggableCard({ lead, disabled }: { lead: BoardLead; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id, disabled });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn(isDragging && "opacity-40")}>
      <LeadCard lead={lead} />
    </div>
  );
}

export function LeadCard({ lead, dragging }: { lead: BoardLead; dragging?: boolean }) {
  const due = dueLabel(lead.nextFollowUpAt);
  return (
    <div className={cn("rounded-md border border-border bg-surface p-2.5 shadow-[var(--shadow-card)] cursor-grab active:cursor-grabbing", dragging && "shadow-[var(--shadow-pop)] rotate-1")}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/leads/${lead.id}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} className="text-[13px] font-medium leading-tight hover:underline line-clamp-2">{lead.address}</Link>
        {lead.urgency === "high" || lead.urgency === "immediate" ? <Flame className="h-3.5 w-3.5 text-warn shrink-0" /> : null}
      </div>
      <div className="text-xs text-fg-3 mt-0.5 truncate">{lead.city}{lead.contact ? ` · ${lead.contact}` : ""}</div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Badge tone={due.tone === "bad" ? "bad" : due.tone === "warn" ? "warn" : due.tone === "good" ? "good" : "neutral"}>{due.text}</Badge>
        {lead.attempts === 0 ? <Badge tone="bad">Untouched</Badge> : null}
        {lead.messy > 0 ? <Badge tone="warn"><AlertTriangle className="h-3 w-3" />{lead.messy}</Badge> : null}
        {lead.tags.filter((t) => t.kind !== "issue").slice(0, 2).map((t) => <Badge key={t.name} tone="brand">{t.name}</Badge>)}
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px] text-fg-3">
        <span className="truncate">{lead.assigned ?? "Unassigned"}</span>
        {lead.askingPrice ? <span className="num">{money(lead.askingPrice)}</span> : <span>{lead.source ?? ""}</span>}
      </div>
    </div>
  );
}
