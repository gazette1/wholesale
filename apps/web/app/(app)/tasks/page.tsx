import Link from "next/link";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { tasks, leads, properties, profiles, contacts } from "@dealcalc/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { listProfiles } from "@/lib/data/leads";
import { addTask } from "@/lib/actions/leads";
import { ActionForm } from "@/components/ui/action-form";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TaskList } from "../leads/[id]/task-list";
import { fullName, cn } from "@/lib/utils";
import { CheckSquare } from "lucide-react";
import { TzOffset } from "@/components/ui/tz-offset";

export const metadata = { title: "Follow ups" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ who?: string; show?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const db = await getDb();
  const who = sp.who ?? session.profileId;
  const where = [eq(tasks.orgId, session.orgId)];
  if (who !== "all") where.push(eq(tasks.assignedTo, who));
  if (sp.show !== "done") where.push(isNull(tasks.doneAt));
  const rows = await db.select({ t: tasks, assignee: profiles.fullName, leadId: leads.id, address: properties.addressLine1, city: properties.city, first: contacts.firstName, last: contacts.lastName, phone: contacts.phones })
    .from(tasks).leftJoin(profiles, eq(tasks.assignedTo, profiles.id)).leftJoin(leads, eq(tasks.leadId, leads.id)).leftJoin(properties, eq(leads.propertyId, properties.id)).leftJoin(contacts, eq(leads.primaryContactId, contacts.id))
    .where(and(...where)).orderBy(asc(tasks.doneAt), asc(tasks.dueAt)).limit(300);
  const team = await listProfiles(session.orgId);
  const now = Date.now();
  const groups = [
    { key: "overdue", label: "Overdue", rows: rows.filter((r) => !r.t.doneAt && r.t.dueAt && r.t.dueAt.getTime() < now && !sameDay(r.t.dueAt)) },
    { key: "today", label: "Today", rows: rows.filter((r) => !r.t.doneAt && r.t.dueAt && sameDay(r.t.dueAt)) },
    { key: "upcoming", label: "Upcoming", rows: rows.filter((r) => !r.t.doneAt && (!r.t.dueAt || (r.t.dueAt.getTime() > now && !sameDay(r.t.dueAt)))) },
    { key: "done", label: "Done", rows: rows.filter((r) => r.t.doneAt) },
  ].filter((g) => g.rows.length);
  return (
    <>
      <PageHeader title="Follow ups" description="Every call, text, and visit that is due. Calling leads and following up repeatedly is the core workflow." actions={
        <form method="get" className="flex gap-2">
          <Select name="who" defaultValue={who} className="w-40"><option value="all">Everyone</option>{team.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</Select>
          <Select name="show" defaultValue={sp.show ?? "open"} className="w-32"><option value="open">Open</option><option value="done">Include done</option></Select>
          <button type="submit" className="text-[13px] text-brand">Apply</button>
        </form>
      } />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {groups.length === 0 ? <EmptyState icon={CheckSquare} title="All caught up" description="No follow ups due." /> : groups.map((g) => (
            <Card key={g.key}>
              <CardHeader title={<span className={cn(g.key === "overdue" && "text-bad")}>{g.label} <span className="text-fg-3 font-normal">({g.rows.length})</span></span>} />
              <CardBody className="p-0">
                <ul className="divide-y divide-border">
                  {g.rows.map((r) => (
                    <li key={r.t.id} className="px-4 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <TaskList tasks={[{ id: r.t.id, title: r.t.title, kind: r.t.kind, dueAt: r.t.dueAt?.toISOString() ?? null, doneAt: r.t.doneAt?.toISOString() ?? null, assignee: r.assignee }]} />
                        <div className="text-xs text-fg-3 ml-6 truncate">{r.leadId ? <Link href={`/leads/${r.leadId}`} className="hover:underline">{r.address}, {r.city}</Link> : "No lead"}{r.first ? ` · ${fullName({ firstName: r.first, lastName: r.last })}` : ""}{(r.phone as any)?.[0]?.number ? ` · ${(r.phone as any)[0].number}` : ""}{who === "all" ? ` · ${r.assignee ?? "Unassigned"}` : ""}</div>
                      </div>
                      <Badge tone="neutral">{r.t.kind}</Badge>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader title="Add a task" description="Tasks without a lead are personal reminders" />
          <CardBody>
            <ActionForm action={addTask.bind(null, null)} submitLabel="Add" variant="outline" resetOnSuccess className="space-y-2">
              <Field label="Title"><Input name="title" required /></Field>
              <Field label="Kind"><Select name="kind" defaultValue="call"><option value="call">Call</option><option value="text">Text</option><option value="email">Email</option><option value="visit">Visit</option><option value="other">Other</option></Select></Field>
              <Field label="Due"><TzOffset /><Input name="dueAt" type="datetime-local" /></Field>
              <Field label="Assign to"><Select name="assignedTo" defaultValue={session.profileId}>{team.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</Select></Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function sameDay(d: Date) {
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
