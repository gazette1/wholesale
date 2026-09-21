"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { moveLeadStage, type ActionResult } from "@/lib/actions/leads";
import { cn, money, dueLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Calculator, Flame } from "lucide-react";
import { LeadQuickViewDrawer, type LeadPatch } from "./quick-view";

export type BoardLead = {
  id: string; propertyId: string; stageId: string; address: string; city: string; contact: string; assigned: string | null; attempts: number; nextFollowUpAt: string | null; askingPrice: number | null; urgency: string; messy: number; source: string | null;
  tags: { name: string; color: string | null; kind: string }[];
  /** Primary analysis of the property (else the latest one that is not trashed). Null when none exists. */
  analysisId: string | null; analysisMao: number | null; analysisSpread: number | null;
};
export type BoardStage = { id: string; key: string; name: string; color: string | null; isTerminal: boolean };

// Enter and Space open the quick view, so the keyboard drag starts with M instead of the dnd-kit default.
const KEYBOARD_CODES = { start: ["KeyM"], cancel: ["Escape"], end: ["KeyM", "Space", "Enter"] };
const SCREEN_READER_INSTRUCTIONS = { draggable: "Press Enter or Space to open the lead quick view. To move this card to another stage, press M to pick it up, use the arrow keys to move it over a stage column, then press M or Enter to drop it. Press Escape to cancel. The stage can also be changed from the quick view." };

export function Board({ stages, leads, canMove, canAnalyze }: { stages: BoardStage[]; leads: BoardLead[]; canMove: boolean; canAnalyze: boolean }) {
  const [items, setItems] = useState(leads);
  // Follow the server: a filter change, a sidebar click, or another person's edit arrives as new props.
  useEffect(() => { setItems(leads); }, [leads]);
  const [active, setActive] = useState<BoardLead | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { keyboardCodes: KEYBOARD_CODES }));
  const byStage = useMemo(() => {
    const map = new Map<string, BoardLead[]>();
    for (const s of stages) map.set(s.id, []);
    for (const l of items) map.get(l.stageId)?.push(l);
    return map;
  }, [items, stages]);
  const nameOf = (id: string) => items.find((l) => l.id === id)?.address ?? "the lead";
  const stageOf = (id: string) => stages.find((st) => st.id === id)?.name ?? "a stage";
  const openLead = useMemo(() => (openId ? items.find((l) => l.id === openId) ?? null : null), [items, openId]);

  /** Optimistic stage change shared by drag and drop and by the quick view stage select. */
  function moveLead(leadId: string, stageId: string): Promise<ActionResult> {
    const lead = items.find((l) => l.id === leadId);
    if (!lead || lead.stageId === stageId) return Promise.resolve({ ok: true });
    const previous = lead.stageId;
    setError(null);
    setItems((prev) => prev.map((l) => (l.id === leadId ? { ...l, stageId } : l)));
    return new Promise((resolve) => {
      startTransition(async () => {
        let res: ActionResult;
        try { res = await moveLeadStage(leadId, stageId); } catch { res = { ok: false, error: "Could not move the lead. Check the connection and try again." }; }
        if (!res.ok) { setError(res.error); setItems((prev) => prev.map((l) => (l.id === leadId ? { ...l, stageId: previous } : l))); }
        resolve(res);
      });
    });
  }

  const patchLead = useCallback((leadId: string, patch: LeadPatch) => {
    setItems((prev) => prev.map((l) => (l.id === leadId ? { ...l, ...patch } : l)));
  }, []);

  function onDragStart(e: DragStartEvent) { setActive(items.find((l) => l.id === e.active.id) ?? null); }
  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const leadId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    void moveLead(leadId, stageId);
  }

  return (
    <>
      {error ? <div className="mb-3 rounded-md border border-[#f3c0c0] bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div> : null}
      <DndContext id="pipeline-board" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}
        accessibility={{
          screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
          // Speak addresses and stage names, not record ids.
          announcements: {
            onDragStart: ({ active: a }) => `Picked up ${nameOf(String(a.id))}.`,
            onDragOver: ({ active: a, over }) => (over ? `${nameOf(String(a.id))} is over ${stageOf(String(over.id))}.` : `${nameOf(String(a.id))} is not over a stage.`),
            onDragEnd: ({ active: a, over }) => (over ? `${nameOf(String(a.id))} was moved to ${stageOf(String(over.id))}.` : `${nameOf(String(a.id))} was put back.`),
            onDragCancel: ({ active: a }) => `Move cancelled. ${nameOf(String(a.id))} was put back.`,
          },
        }}>
        <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin -mx-1 px-1 min-h-[70vh] snap-x">
          {stages.map((s) => <Column key={s.id} stage={s} leads={byStage.get(s.id) ?? []} canMove={canMove} onOpen={setOpenId} />)}
        </div>
        <DragOverlay>{active ? <LeadCard lead={active} dragging movable /> : null}</DragOverlay>
      </DndContext>
      <LeadQuickViewDrawer lead={openLead} stages={stages} canMove={canMove} canAnalyze={canAnalyze} onClose={() => setOpenId(null)} onStageChange={moveLead} onLeadPatch={patchLead} />
    </>
  );
}

function Column({ stage, leads, canMove, onOpen }: { stage: BoardStage; leads: BoardLead[]; canMove: boolean; onOpen: (leadId: string) => void }) {
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
        {leads.map((l) => <DraggableCard key={l.id} lead={l} disabled={!canMove} onOpen={onOpen} />)}
        {leads.length === 0 ? <div className="text-[11px] text-fg-3 text-center py-6 border border-dashed border-border rounded-md">{canMove ? "Drop leads here" : "No leads"}</div> : null}
      </div>
    </div>
  );
}

function DraggableCard({ lead, disabled, onOpen }: { lead: BoardLead; disabled: boolean; onOpen: (leadId: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id, disabled });
  // A plain click never reaches the 6px drag threshold, and dnd-kit swallows the click that ends a real drag, so onClick only fires for clicks.
  const a11y = disabled ? { role: "button" as const, tabIndex: 0 } : attributes;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...a11y}
      data-lead-card={lead.id}
      aria-label={`${lead.address}, ${lead.city}. Open quick view.`}
      aria-haspopup="dialog"
      onClick={() => onOpen(lead.id)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.defaultPrevented || isDragging || e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(lead.id); }
      }}
      className={cn("rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50", isDragging && "opacity-40")}
    >
      <LeadCard lead={lead} movable={!disabled} />
    </div>
  );
}

export function LeadCard({ lead, dragging, movable }: { lead: BoardLead; dragging?: boolean; movable?: boolean }) {
  const due = dueLabel(lead.nextFollowUpAt);
  const hasNumbers = lead.analysisMao != null || lead.analysisSpread != null;
  return (
    <div className={cn("rounded-md border border-border bg-surface p-2.5 shadow-[var(--shadow-card)] transition-colors hover:border-fg-3/50", movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer", dragging && "shadow-[var(--shadow-pop)] rotate-1")}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/leads/${lead.id}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="text-[13px] font-medium leading-tight hover:underline line-clamp-2">{lead.address}</Link>
        {lead.urgency === "high" || lead.urgency === "immediate" ? <Flame className="h-3.5 w-3.5 text-warn shrink-0" /> : null}
      </div>
      <div className="text-xs text-fg-3 mt-0.5 truncate">{lead.city}{lead.contact ? ` · ${lead.contact}` : ""}</div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Badge tone={due.tone === "bad" ? "bad" : due.tone === "warn" ? "warn" : due.tone === "good" ? "good" : "neutral"}>{due.text}</Badge>
        {lead.attempts === 0 ? <Badge tone="bad">Untouched</Badge> : null}
        {lead.messy > 0 ? <Badge tone="warn"><AlertTriangle className="h-3 w-3" />{lead.messy}</Badge> : null}
        {lead.tags.filter((t) => t.kind !== "issue").slice(0, 2).map((t) => <Badge key={t.name} tone="brand">{t.name}</Badge>)}
      </div>
      {lead.analysisId ? (
        <div className="flex items-center justify-between gap-2 mt-2 rounded bg-surface-2 pl-2 pr-1 py-0.5 text-[11px]">
          <span className="num truncate text-fg-2">
            {hasNumbers ? (
              <>
                {lead.analysisMao != null ? <>MAO {money(lead.analysisMao)}</> : null}
                {lead.analysisMao != null && lead.analysisSpread != null ? " · " : null}
                {lead.analysisSpread != null ? <>Spread <span className={lead.analysisSpread > 0 ? "text-good" : "text-bad"}>{money(lead.analysisSpread)}</span></> : null}
              </>
            ) : "Analysis started"}
          </span>
          <Link
            href={`/analyzer/${lead.analysisId}`}
            onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
            aria-label={`Open the deal analyzer for ${lead.address}`} title="Open deal analyzer"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-3 hover:bg-brand-soft hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Calculator className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : null}
      <div className="flex items-center justify-between mt-2 text-[11px] text-fg-3">
        <span className="truncate">{lead.assigned ?? "Unassigned"}</span>
        {lead.askingPrice ? <span className="num">{money(lead.askingPrice)}</span> : <span>{lead.source ?? ""}</span>}
      </div>
    </div>
  );
}
