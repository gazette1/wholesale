"use client";
import * as React from "react";
import { useCallback, useRef, useState } from "react";

export type DragItem = { kind: "section" | "field"; id: string };
/** Where a drag would land. For a field drop, `id` is the field or section element under the pointer. */
export type DropTarget = { kind: "section" | "field"; id: string; after: boolean };

/** Reorder by pointer events only. Drop zones carry data-drop="section:KEY" or data-drop="field:KEY". */
export function usePointerDrag(onDrop: (item: DragItem, target: DropTarget) => void) {
  const [drag, setDrag] = useState<{ item: DragItem; target: DropTarget | null } | null>(null);
  const active = useRef<{ item: DragItem; target: DropTarget | null } | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const find = useCallback((item: DragItem, x: number, y: number): DropTarget | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const selector = item.kind === "section" ? '[data-drop^="section:"]' : '[data-drop^="field:"], [data-drop^="section:"]';
    const zone = el.closest<HTMLElement>(selector);
    if (!zone) return null;
    const [kind, ...rest] = (zone.dataset.drop ?? "").split(":");
    const id = rest.join(":");
    if (!id || (kind !== "section" && kind !== "field")) return null;
    if (item.kind === kind && item.id === id) return null;
    const rect = zone.getBoundingClientRect();
    // Over a section while moving a field means: drop at the end of that section.
    const after = kind === "section" && item.kind === "field" ? true : y > rect.top + rect.height / 2;
    return { kind, id, after };
  }, []);

  const finish = useCallback((commit: boolean) => {
    const cur = active.current;
    active.current = null;
    setDrag(null);
    if (commit && cur?.target) onDropRef.current(cur.item, cur.target);
  }, []);

  const handleProps = useCallback((item: DragItem) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      active.current = { item, target: null };
      setDrag({ item, target: null });
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const cur = active.current;
      if (!cur) return;
      const target = find(cur.item, e.clientX, e.clientY);
      cur.target = target;
      setDrag((d) => (d && d.item.id === cur.item.id && d.item.kind === cur.item.kind ? { item: d.item, target } : d));
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      finish(true);
    },
    onPointerCancel: () => finish(false),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => { if (e.key === "Escape") finish(false); },
    style: { touchAction: "none" as const, cursor: "grab" },
  }), [find, finish]);

  return { drag, handleProps };
}
