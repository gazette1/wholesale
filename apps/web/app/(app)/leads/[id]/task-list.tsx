"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeTask } from "@/lib/actions/leads";
import { dueLabel, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function TaskList({ tasks }: { tasks: { id: string; title: string; kind: string; dueAt: string | null; doneAt: string | null; assignee: string | null }[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!tasks.length) return <p className="text-xs text-fg-3">No follow ups yet.</p>;
  return (
    <ul className={cn("space-y-1.5", pending && "opacity-60")}>
      {tasks.map((t) => {
        const due = dueLabel(t.dueAt);
        return (
          <li key={t.id} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={Boolean(t.doneAt)} className="h-4 w-4" onChange={(e) => start(async () => { await completeTask(t.id, e.target.checked); router.refresh(); })} />
            <span className={cn("flex-1 min-w-0 truncate", t.doneAt && "line-through text-fg-3")}>{t.title}</span>
            {!t.doneAt ? <Badge tone={due.tone === "bad" ? "bad" : due.tone === "warn" ? "warn" : "neutral"}>{due.text}</Badge> : null}
          </li>
        );
      })}
    </ul>
  );
}
