"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionForm } from "@/components/ui/action-form";
import { createAnalysisFromPicker } from "@/lib/actions/analyzer";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";

export type PickerLead = { leadId: string; propertyId: string; address: string; city: string; state: string; analyses: number };

/** Start an analysis from the analyzer list by picking one of the open leads. */
export function NewAnalysis({ leads }: { leads: PickerLead[] }) {
  const [q, setQ] = useState("");
  const [target, setTarget] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (needle ? leads.filter((l) => `${l.address} ${l.city} ${l.state}`.toLowerCase().includes(needle)) : leads).slice(0, 60);
  }, [q, leads]);
  return (
    <Dialog onOpenChange={(open) => { if (!open) { setQ(""); setTarget(""); } }}>
      <DialogTrigger asChild><Button type="button" variant="primary"><Plus className="h-4 w-4" />New analysis</Button></DialogTrigger>
      <DialogContent title="New analysis" description="Pick the lead to analyze. The analysis starts from the property report, the rehab checklist defaults, and the lead's asking price.">
        {leads.length === 0 ? (
          <div className="space-y-3 text-[13px]"><p className="text-fg-2">There are no open leads yet. Add a lead first, then analyze it.</p><LinkButton href="/leads/new" variant="primary">New lead</LinkButton></div>
        ) : (
          <ActionForm action={createAnalysisFromPicker} submitLabel="Create analysis" className="space-y-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by address or city" aria-label="Search leads" autoFocus />
            <input type="hidden" name="target" value={target} />
            <div role="listbox" aria-label="Open leads" className="max-h-72 overflow-y-auto border border-border rounded-md divide-y divide-border/60">
              {rows.length === 0 ? <p className="p-3 text-xs text-fg-3">No open lead matches that search.</p> : null}
              {rows.map((l) => {
                const value = `${l.leadId}|${l.propertyId}`;
                return (
                  <button key={l.leadId} type="button" role="option" aria-selected={target === value} onClick={() => setTarget(value)} className={cn("w-full text-left px-3 py-2 text-[13px] flex items-center justify-between gap-3 hover:bg-surface-2", target === value && "bg-brand-soft")}>
                    <span className="min-w-0"><span className="font-medium block truncate">{l.address}</span><span className="text-xs text-fg-3">{l.city}, {l.state}</span></span>
                    <span className="text-xs text-fg-3 shrink-0">{l.analyses === 0 ? "No analysis yet" : `${l.analyses} ${l.analyses === 1 ? "version" : "versions"}`}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-fg-3">Not in the list? <Link href="/leads/new" className="text-brand hover:underline">Add the lead first</Link>. Every analysis belongs to a property so it shows up on the pipeline card and the lead.</p>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}
