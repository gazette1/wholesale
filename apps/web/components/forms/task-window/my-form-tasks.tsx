import Link from "next/link";
import type { MyTaskRow, MyTasks } from "@/lib/forms/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { cn, shortDate } from "@/lib/utils";

function TaskList({ title, rows, empty, snoozed }: { title: string; rows: MyTaskRow[]; empty: string; snoozed?: boolean }) {
  return (
    <Card>
      <CardHeader title={<span>{title} <span className="text-fg-3 font-normal">({rows.length})</span></span>} />
      <CardBody className="p-0">
        {rows.length === 0 ? <p className="px-4 py-3 text-[13px] text-fg-3">{empty}</p> : (
          <ul className="divide-y divide-border">
            {rows.map((t) => (
              <li key={t.taskId} className="px-4 py-2.5 flex items-center gap-3 min-w-0">
                <div className="flex-1 min-w-0">
                  <Link href={`/forms/tasks/${t.taskId}`} className={cn("block truncate text-[13px] hover:underline", t.unread && "font-semibold")}>{t.formName}: {t.sectionTitle}</Link>
                  {t.subjectLabel ? <div className="text-xs text-fg-3 truncate">{t.subjectLabel}</div> : null}
                </div>
                <span className="flex items-center gap-2 shrink-0">
                  {t.unread ? <Badge tone="brand">Unread</Badge> : null}
                  {t.needsApproval ? <Badge tone="warn">Approval</Badge> : null}
                  {snoozed && t.snoozedUntil ? <span className="text-xs text-fg-3">Until {shortDate(t.snoozedUntil)}</span> : t.dueAt ? <span className={cn("text-xs", t.overdue ? "text-bad" : "text-fg-3")}>{t.overdue ? "Overdue, " : "Due "}{shortDate(t.dueAt)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** The signed in person's form tasks: open, pending approvals, and snoozed. Renders nothing when there are none. */
export function MyFormTasks({ tasks }: { tasks: MyTasks }) {
  if (tasks.open.length + tasks.approvals.length + tasks.snoozed.length === 0) return null;
  return (
    <section aria-labelledby="form-tasks-heading" className="mb-4 space-y-3">
      <h2 id="form-tasks-heading" className="text-sm font-semibold">Form tasks{tasks.unreadCount ? <span className="ml-2 text-xs font-normal text-fg-3">{tasks.unreadCount} unread</span> : null}</h2>
      <div className="grid gap-3 lg:grid-cols-3">
        <TaskList title="Assigned to me" rows={tasks.open} empty="No open form tasks." />
        <TaskList title="Pending approvals" rows={tasks.approvals} empty="No approvals waiting." />
        <TaskList title="Snoozed" rows={tasks.snoozed} empty="Nothing snoozed." snoozed />
      </div>
    </section>
  );
}
