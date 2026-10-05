"use client";
import * as React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/leads";
import { bulkAssign, bulkTag, bulkEnroll, matchingLeadIds } from "@/lib/actions/leads-bulk";
import type { LeadFilters } from "@/lib/data/leads";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

type MatchAll = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; total: number; capped: boolean };

type Ctx = {
  ids: string[]; selected: string[];
  toggle: (id: string, on: boolean, shiftKey?: boolean) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
  matchAll: MatchAll;
  selectAllMatching: () => void;
};
const BulkCtx = createContext<Ctx | null>(null);

/**
 * Holds the checked rows for the leads table. `ids` is the page of rows on screen: a plain toggle or "select all
 * on this page" only ever adds ids from `ids`, so a filter change or a page change never leaves hidden rows
 * selected. "Select all matching filters" is the deliberate exception: it fetches ids beyond this page from the
 * server and holds onto them until the selection is cleared or edited by hand.
 */
export function BulkSelectProvider({ ids, filters = {}, children }: { ids: string[]; filters?: LeadFilters; children: React.ReactNode }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [matchAll, setMatchAll] = useState<MatchAll>({ status: "idle" });
  const lastClicked = useRef<string | null>(null);

  const toggle = useCallback((id: string, on: boolean, shiftKey?: boolean) => {
    const anchor = lastClicked.current;
    lastClicked.current = id;
    setMatchAll({ status: "idle" });
    setPicked((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchor && anchor !== id) {
        const from = ids.indexOf(anchor);
        const to = ids.indexOf(id);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          for (const rid of ids.slice(lo, hi + 1)) { if (on) next.add(rid); else next.delete(rid); }
          return next;
        }
      }
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }, [ids]);

  const setAll = useCallback((on: boolean) => { setMatchAll({ status: "idle" }); setPicked(on ? new Set(ids) : new Set()); }, [ids]);
  const clear = useCallback(() => { setMatchAll({ status: "idle" }); setPicked(new Set()); }, []);

  const selectAllMatching = useCallback(() => {
    setMatchAll({ status: "loading" });
    matchingLeadIds(filters).then((res) => {
      if (!res.ok) { setMatchAll({ status: "error", message: res.error }); return; }
      const proceed = window.confirm(res.capped
        ? `Your filters match ${res.total} leads. This selects the first ${res.ids.length} of them (the most a bulk action can take at once). Continue?`
        : `Select all ${res.total} lead${res.total === 1 ? "" : "s"} matching your filters?`);
      if (!proceed) { setMatchAll({ status: "idle" }); return; }
      setPicked(new Set(res.ids));
      setMatchAll({ status: "done", total: res.total, capped: res.capped });
    }).catch(() => setMatchAll({ status: "error", message: "Something went wrong. Try again." }));
  }, [filters]);

  // Once "select all matching" has run, the selection can span rows outside this page, so it is read straight from picked.
  const selected = useMemo(() => (matchAll.status === "done" ? [...picked] : ids.filter((id) => picked.has(id))), [matchAll, picked, ids]);
  const value = useMemo<Ctx>(() => ({ ids, selected, toggle, setAll, clear, matchAll, selectAllMatching }), [ids, selected, toggle, setAll, clear, matchAll, selectAllMatching]);
  return <BulkCtx.Provider value={value}>{children}</BulkCtx.Provider>;
}

function useBulk(): Ctx {
  const ctx = useContext(BulkCtx);
  if (!ctx) throw new Error("Bulk select controls must sit inside BulkSelectProvider.");
  return ctx;
}

const boxClass = "h-4 w-4 shrink-0 cursor-pointer align-middle";
// The label fills the cell, so a near miss toggles the box instead of opening the lead.
const hitClass = "flex items-center justify-center -my-2 py-2 -ml-3 pl-3 pr-1 cursor-pointer";

/** Shift click extends the selection to every row between the last clicked one and this one. */
export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useBulk();
  const checked = selected.includes(id);
  return (
    <label className={hitClass} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className={boxClass} aria-label={`Select ${label}`} checked={checked} onChange={() => {}} onClick={(e) => { e.preventDefault(); toggle(id, !checked, e.shiftKey); }} />
    </label>
  );
}

export function HeaderCheckbox() {
  const { ids, selected, setAll } = useBulk();
  const ref = useRef<HTMLInputElement>(null);
  const all = ids.length > 0 && selected.length === ids.length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = selected.length > 0 && !all; }, [selected.length, all]);
  return (
    <label className={hitClass}>
      <input ref={ref} type="checkbox" className={boxClass} aria-label={all ? "Clear selection" : `Select all ${ids.length} leads on this page`} checked={all} onChange={(e) => setAll(e.target.checked)} />
    </label>
  );
}

type Option = { id: string; name: string };

/** Appears once a row is checked. Each control calls its server action with the checked ids and reports the counts the action returns. */
export function BulkBar({ team, tags, campaigns, canEnroll }: { team: Option[]; tags: Option[]; campaigns: Option[]; canEnroll: boolean }) {
  const { ids, selected, clear, matchAll, selectAllMatching } = useBulk();
  const router = useRouter();
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [assignee, setAssignee] = useState("");
  const [moveTasks, setMoveTasks] = useState(false);
  const [tagId, setTagId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [running, setRunning] = useState<"assign" | "add" | "remove" | "enroll" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function run(key: NonNullable<typeof running>, action: (ids: string[]) => Promise<ActionResult>) {
    if (busy.current || selected.length === 0) return;
    busy.current = true;
    setRunning(key);
    const ids = selected;
    start(async () => {
      try {
        const res = await action(ids);
        setResult(res);
        if (timer.current) clearTimeout(timer.current);
        if (res.ok) {
          // The bar hides with the selection, so the result line stays up on its own for a while.
          timer.current = setTimeout(() => setResult(null), 10_000);
          clear();
          router.refresh();
        }
      } catch {
        setResult({ ok: false, error: "Something went wrong. Try again." });
      } finally {
        busy.current = false;
      }
    });
  }

  if (selected.length === 0 && !result) return null;
  const message = result ? <span role={result.ok ? "status" : "alert"} className={cn("text-xs", result.ok ? "text-good" : "text-bad")}>{result.ok ? result.message ?? "Done" : result.error}</span> : null;
  if (selected.length === 0) return <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">{message}<button type="button" onClick={() => setResult(null)} className="rounded-md p-0.5 text-fg-3 hover:bg-black/5 hover:text-fg" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button></div>;
  const allOnPage = ids.length > 0 && selected.length === ids.length && matchAll.status !== "done";
  return (
    <div role="region" aria-label="Bulk actions" className="mb-3 rounded-lg border border-brand/40 bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[13px] font-medium" aria-live="polite">{selected.length} selected</span>
        <div className="flex items-center gap-1.5">
          <Select aria-label="Assign selected leads to" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-40" disabled={pending}>
            <option value="">Assign to</option><option value="unassigned">Unassigned</option>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <label className="flex items-center gap-1 text-xs text-fg-3"><input type="checkbox" className="h-3.5 w-3.5" checked={moveTasks} onChange={(e) => setMoveTasks(e.target.checked)} disabled={pending} />Move open tasks too</label>
          <Button type="button" variant="outline" size="md" loading={pending && running === "assign"} disabled={!assignee || pending} onClick={() => run("assign", (ids) => bulkAssign(ids, assignee === "unassigned" ? null : assignee, moveTasks))}>Apply</Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Select aria-label="Tag for selected leads" value={tagId} onChange={(e) => setTagId(e.target.value)} className="w-36" disabled={pending || tags.length === 0}>
            <option value="">{tags.length ? "Tag" : "No tags yet"}</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Button type="button" variant="outline" size="md" loading={pending && running === "add"} disabled={!tagId || pending} onClick={() => run("add", (ids) => bulkTag(ids, tagId, true))}>Add</Button>
          <Button type="button" variant="outline" size="md" loading={pending && running === "remove"} disabled={!tagId || pending} onClick={() => run("remove", (ids) => bulkTag(ids, tagId, false))}>Remove</Button>
        </div>
        {canEnroll ? (
          <div className="flex items-center gap-1.5">
            <Select aria-label="Campaign for selected leads" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="w-44" disabled={pending || campaigns.length === 0}>
              <option value="">{campaigns.length ? "Enroll in campaign" : "No active campaigns"}</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Button type="button" variant="outline" size="md" loading={pending && running === "enroll"} disabled={!campaignId || pending} onClick={() => run("enroll", (ids) => bulkEnroll(ids, campaignId))}>Enroll</Button>
          </div>
        ) : null}
        <Button type="button" variant="ghost" size="md" onClick={() => { clear(); setResult(null); }} disabled={pending}>Clear</Button>
      </div>
      {allOnPage ? (
        <div className="mt-1.5 text-xs text-fg-3">
          All {ids.length} leads on this page are selected.{" "}
          <button type="button" className="text-brand hover:underline disabled:opacity-50" disabled={matchAll.status === "loading"} onClick={selectAllMatching}>
            {matchAll.status === "loading" ? "Counting matching leads…" : "Select every lead matching your filters"}
          </button>
        </div>
      ) : null}
      {matchAll.status === "done" ? <p className="mt-1.5 text-xs text-fg-3">Selected every lead matching your filters{matchAll.capped ? `, up to the ${selected.length}-lead limit on one bulk action` : ""} ({matchAll.total} match{matchAll.total === 1 ? "" : "es"}).</p> : null}
      {matchAll.status === "error" ? <p role="alert" className="mt-1.5 text-xs text-bad">{matchAll.message}</p> : null}
      {message ? <div className="mt-1.5">{message}</div> : null}
    </div>
  );
}
