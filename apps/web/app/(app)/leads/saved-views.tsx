"use client";
import * as React from "react";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/leads";
import { saveView, deleteView, toggleShared, updateView } from "@/lib/actions/saved-views";
import type { SavedView } from "@/lib/data/saved-views";
import { LEAD_COLUMN_KEYS, type SavedViewEntity } from "@/lib/saved-view-config";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2, Users, Pencil, X } from "lucide-react";

type Sort = { id: string; desc: boolean } | null;

const BASE_PATH: Record<SavedViewEntity, string> = { leads: "/leads", buyers: "/buyers" };
/** Mirrors the `label` of every entry in COLUMNS in app/(app)/leads/page.tsx. */
const COLUMN_LABELS: Record<(typeof LEAD_COLUMN_KEYS)[number], string> = { address: "Property", contact: "Seller", stage: "Stage", followUp: "Follow up", attempts: "Attempts", asking: "Asking", motivation: "Motivation", source: "Source", assigned: "Owner", created: "Created" };

function viewHref(basePath: string, filters: Record<string, string>, sort: Sort, columns?: string[]): string {
  const p = new URLSearchParams(filters);
  if (sort) { p.set("sort", sort.id); p.set("dir", sort.desc ? "desc" : "asc"); }
  if (columns?.length) p.set("cols", columns.join(","));
  return `${basePath}?${p.toString()}`;
}

const chip = "rounded-full border border-border bg-surface px-2.5 py-1 hover:bg-surface-2";

/** A small control inside a view pill. Errors go to the parent so they show under the row, not inside the pill. */
function PillAction({ action, label, confirm, onError, children }: { action: () => Promise<ActionResult>; label: string; confirm?: string; onError: (message: string | null) => void; children: React.ReactNode }) {
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const router = useRouter();
  return (
    <button type="button" aria-label={label} title={label} disabled={pending} className="rounded-full p-1 text-fg-3 hover:bg-black/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50" onClick={() => {
      if (busy.current) return;
      if (confirm && !window.confirm(confirm)) return;
      busy.current = true;
      start(async () => {
        try {
          const res = await action();
          onError(res.ok ? null : res.error);
          if (res.ok) router.refresh();
        } catch {
          onError("Something went wrong. Try again.");
        } finally {
          busy.current = false;
        }
      });
    }}>{pending ? <Loader2 className="h-3 w-3 animate-spin" /> : children}</button>
  );
}

/** Checkbox grid for picking which columns a leads view shows. Buyers has no column picker yet, so this renders nothing for it. */
function ColumnPicker({ entity, defaultChecked }: { entity: SavedViewEntity; defaultChecked?: readonly string[] }) {
  if (entity !== "leads") return null;
  const checked = new Set(defaultChecked ?? []);
  return (
    <fieldset className="mt-3">
      <legend className="text-xs text-fg-3 mb-1">Columns (leave all unchecked to show every column)</legend>
      <div className="grid grid-cols-2 gap-1">
        {LEAD_COLUMN_KEYS.map((k) => (
          <label key={k} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="columns" value={k} defaultChecked={checked.has(k)} className="h-3.5 w-3.5" />{COLUMN_LABELS[k]}</label>
        ))}
      </div>
    </fieldset>
  );
}

/** Rename a view, or overwrite it with the filters, sort, and columns applied right now. Replaces delete-then-save-again. */
function EditViewDialog({ view, entity, current, sort, onError }: { view: SavedView; entity: SavedViewEntity; current: Record<string, string>; sort: Sort; onError: (message: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const nothingToOverwrite = Object.keys(current).length === 0 && !sort;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><button type="button" aria-label={`Edit ${view.name}`} title={`Rename or overwrite ${view.name}`} className="rounded-full p-1 text-fg-3 hover:bg-black/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><Pencil className="h-3 w-3" /></button></DialogTrigger>
      <DialogContent title={`Edit "${view.name}"`} description="Rename it, or overwrite it with what is applied right now.">
        <ActionForm action={updateView.bind(null, view.id)} submitLabel="Save" onSuccess={() => { onError(null); setOpen(false); }}>
          <Field label="Name"><Input name="name" required maxLength={60} defaultValue={view.name} autoFocus /></Field>
          <label className={cn("mt-3 flex items-center gap-2 text-[13px]", nothingToOverwrite && "opacity-50")}>
            <input type="checkbox" name="overwrite" className="h-4 w-4" checked={overwrite} disabled={nothingToOverwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            Also replace its filters, sort, and columns with what is applied right now
          </label>
          {overwrite ? (
            <>
              <input type="hidden" name="filters" value={JSON.stringify(current)} />
              {sort ? <><input type="hidden" name="sort" value={sort.id} /><input type="hidden" name="dir" value={sort.desc ? "desc" : "asc"} /></> : null}
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {Object.entries(current).map(([k, v]) => <React.Fragment key={k}><dt className="text-fg-3">{k}</dt><dd className="break-words">{v}</dd></React.Fragment>)}
                {sort ? <><dt className="text-fg-3">sort</dt><dd>{sort.id}, {sort.desc ? "descending" : "ascending"}</dd></> : null}
              </dl>
              <ColumnPicker entity={entity} defaultChecked={view.columns} />
            </>
          ) : null}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The view row above the leads or buyers table: built in views, then the user's own, then views a teammate shared.
 * `current` and `sort` describe the filters in the URL right now; they are what Save current view stores.
 */
export function SavedViews({ builtIn, views, current, sort, canShare, entity = "leads" }: { builtIn: { label: string; filters: Record<string, string> }[]; views: SavedView[]; current: Record<string, string>; sort: Sort; canShare: boolean; entity?: SavedViewEntity }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nothingToSave = Object.keys(current).length === 0 && !sort;
  const mine = views.filter((v) => v.mine);
  const shared = views.filter((v) => !v.mine);
  const basePath = BASE_PATH[entity];
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-fg-3 mr-1">Saved views:</span>
        {builtIn.map((v) => <Link key={v.label} href={viewHref(basePath, v.filters, null)} title="Built in view" className={chip}>{v.label}</Link>)}
        {mine.length ? <span aria-hidden className="mx-1 h-4 w-px bg-border" /> : null}
        {mine.map((v) => (
          <span key={v.id} className="inline-flex items-center rounded-full border border-border bg-surface pr-1 hover:bg-surface-2">
            <Link href={viewHref(basePath, v.filters, v.sort, v.columns)} className="py-1 pl-2.5 pr-1">{v.name}</Link>
            <EditViewDialog view={v} entity={entity} current={current} sort={sort} onError={setError} />
            {canShare || v.isShared ? (
              <PillAction action={toggleShared.bind(null, v.id)} label={v.isShared ? `Stop sharing ${v.name} with the team` : `Share ${v.name} with the team`} onError={setError}><Users className={cn("h-3 w-3", v.isShared && "text-brand")} /></PillAction>
            ) : null}
            <PillAction action={deleteView.bind(null, v.id)} label={`Delete view ${v.name}`} confirm={v.isShared ? `Delete the view "${v.name}"? It is shared, so the team loses it too.` : `Delete the view "${v.name}"?`} onError={setError}><X className="h-3 w-3" /></PillAction>
          </span>
        ))}
        {shared.length ? <span aria-hidden className="mx-1 h-4 w-px bg-border" /> : null}
        {shared.map((v) => (
          <Link key={v.id} href={viewHref(basePath, v.filters, v.sort, v.columns)} title={v.ownerName ? `Shared by ${v.ownerName}` : "Shared view"} className={cn(chip, "inline-flex items-center gap-1")}>{v.name}<span className="text-[10px] text-fg-3">shared</span></Link>
        ))}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button type="button" variant="ghost" size="sm" className="ml-1" disabled={nothingToSave} title={nothingToSave ? "Set a filter or a sort first" : undefined}>Save current view</Button></DialogTrigger>
          <DialogContent title="Save current view" description="Stores the filters, sort, and columns that are applied right now.">
            <ActionForm action={saveView} submitLabel="Save view" onSuccess={() => setOpen(false)}>
              <input type="hidden" name="entity" value={entity} />
              <input type="hidden" name="filters" value={JSON.stringify(current)} />
              {sort ? <><input type="hidden" name="sort" value={sort.id} /><input type="hidden" name="dir" value={sort.desc ? "desc" : "asc"} /></> : null}
              <Field label="Name"><Input name="name" required maxLength={60} autoFocus placeholder="Hot leads in Baltimore" /></Field>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {Object.entries(current).map(([k, v]) => <React.Fragment key={k}><dt className="text-fg-3">{k}</dt><dd className="break-words">{v}</dd></React.Fragment>)}
                {sort ? <><dt className="text-fg-3">sort</dt><dd>{sort.id}, {sort.desc ? "descending" : "ascending"}</dd></> : null}
              </dl>
              <ColumnPicker entity={entity} />
              {canShare ? <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" name="isShared" className="h-4 w-4" />Share with the team</label> : null}
            </ActionForm>
          </DialogContent>
        </Dialog>
      </div>
      {error ? <p role="alert" className="mt-1 text-xs text-bad">{error}</p> : null}
    </div>
  );
}
