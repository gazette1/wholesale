"use client";
import { useMemo, useState } from "react";
import { GLOSSARY, GLOSSARY_SECTIONS } from "@dealcalc/engine";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen } from "lucide-react";

/** The workbook's Definitions sheet, searchable. Reading aid only; the labeled inputs govern results. */
export function FieldGuide() {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? GLOSSARY.filter((g) => g.name.toLowerCase().includes(needle) || g.definition.toLowerCase().includes(needle) || g.section.toLowerCase().includes(needle)) : GLOSSARY;
  }, [q]);
  return (
    <Dialog onOpenChange={(open) => { if (!open) setQ(""); }}>
      <DialogTrigger asChild><Button type="button" variant="ghost" size="sm"><BookOpen className="h-3.5 w-3.5" />Field guide</Button></DialogTrigger>
      <DialogContent title="Field guide" description="Workbook definitions. The labeled inputs and the calculation rules in this app govern its results." wide>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms, such as points or holding" aria-label="Search the field guide" autoFocus />
        <div className="mt-3 space-y-4">
          {rows.length === 0 ? <p className="text-[13px] text-fg-3">No definitions match that search.</p> : null}
          {GLOSSARY_SECTIONS.map((section) => {
            const items = rows.filter((g) => g.section === section);
            if (items.length === 0) return null;
            return (
              <section key={section}>
                <h4 className="text-[11px] uppercase tracking-wide text-fg-3 mb-1">{section}</h4>
                <dl className="divide-y divide-border/60 border border-border rounded-md">
                  {items.map((g) => (
                    <div key={g.source} className="px-3 py-2">
                      <dt className="text-[13px] font-medium flex items-baseline justify-between gap-3"><span>{g.name}</span><span className="text-[11px] font-normal text-fg-3 shrink-0">{g.source}</span></dt>
                      <dd className="text-[13px] text-fg-2 mt-0.5">{g.definition}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
