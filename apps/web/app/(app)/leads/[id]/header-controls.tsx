"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveLeadStage, updateLeadFields } from "@/lib/actions/leads";
import { Select, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function LeadHeaderControls({ leadId, stageId, stages, assignedTo, team, nextFollowUpAt, dueText, dueTone, canWrite }: {
  leadId: string; stageId: string; stages: { id: string; name: string; color: string | null }[]; assignedTo: string | null; team: { id: string; name: string }[];
  nextFollowUpAt: string | null; dueText: string; dueTone: "bad" | "warn" | "good" | "muted"; canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const local = nextFollowUpAt ? toLocalInput(new Date(nextFollowUpAt)) : "";
  function update(form: FormData) {
    start(async () => {
      const res = await updateLeadFields(leadId, form);
      if (!res.ok) setError(res.error); else { setError(null); router.refresh(); }
    });
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2", pending && "opacity-70")}>
      <label className="flex items-center gap-2 text-xs text-fg-3">Stage
        <Select value={stageId} disabled={!canWrite} className="w-44" onChange={(e) => start(async () => { const res = await moveLeadStage(leadId, e.target.value); if (!res.ok) setError(res.error); else router.refresh(); })}>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </label>
      <label className="flex items-center gap-2 text-xs text-fg-3">Owner
        <Select value={assignedTo ?? ""} disabled={!canWrite} className="w-40" onChange={(e) => { const f = new FormData(); f.set("assignedTo", e.target.value); update(f); }}>
          <option value="">Unassigned</option>
          {team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </label>
      <label className="flex items-center gap-2 text-xs text-fg-3">Next follow up
        <Input type="datetime-local" defaultValue={local} disabled={!canWrite} className="w-48" onBlur={(e) => { if (e.target.value !== local) { const f = new FormData(); f.set("nextFollowUpAt", e.target.value ? new Date(e.target.value).toISOString() : ""); update(f); } }} />
      </label>
      <Badge tone={dueTone === "bad" ? "bad" : dueTone === "warn" ? "warn" : dueTone === "good" ? "good" : "neutral"}>{dueText}</Badge>
      {error ? <span className="text-xs text-bad">{error}</span> : null}
    </div>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
