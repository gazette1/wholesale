"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeTask } from "@/lib/actions/leads";
import { dueLabel, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function TaskList({ tasks }: { tasks: { id: string; title: string; kind: string; dueAt: string | null; doneAt: string | null; assignee: string | null }[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const router = useRouter();
  if (!tasks.length) return <p className="text-xs text-fg-3">No follow ups yet.</p>;
  return (
    <>
      {error ? <p role="alert" className="text-xs text-bad mb-1">{error}</p> : null}
      <ul className={cn("space-y-1.5", pending && "opacity-60")}>
        {tasks.map((t) => {
          const due = dueLabel(t.dueAt);
          return (
            <li key={t.id} className="flex items-center gap-2 text-[13px] min-w-0">
              <input type="checkbox" checked={Boolean(t.doneAt)} disabled={pending} className="h-4 w-4 shrink-0" aria-label={`${t.doneAt ? "Reopen" : "Complete"}: ${t.title}`}
                onChange={(e) => {
                  // One request at a time, so a double click cannot log the completion twice.
                  if (busy.current) return;
                  busy.current = true;
                  const done = e.target.checked;
                  start(async () => {
                    try { const res = await completeTask(t.id, done); setError(res.ok ? null : res.error); router.refresh(); } finally { busy.current = false; }
                  });
                }} />
              <span className={cn("flex-1 min-w-0 truncate", t.doneAt && "line-through text-fg-3")} title={t.title}>{t.title}</span>
              {!t.doneAt ? <Badge tone={due.tone === "bad" ? "bad" : due.tone === "warn" ? "warn" : "neutral"} className="shrink-0">{due.text}</Badge> : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
