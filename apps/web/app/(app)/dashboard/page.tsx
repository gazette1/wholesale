import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { dashboardData, myTasksDue } from "@/lib/data/dashboard";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader, CardBody, Kpi } from "@/components/ui/card";
import { StageBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { relative, dueLabel, fullName } from "@/lib/utils";
import { SourceChart } from "./charts";
import { Phone, Plus } from "lucide-react";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await requireSession();
  const [data, tasks] = await Promise.all([dashboardData(session.orgId), myTasksDue(session.orgId, session.profileId)]);
  const speed = data.avgFirstResponseMinutes;
  return (
    <>
      <PageHeader title={`Good ${greeting()}, ${session.fullName.split(" ")[0]}`} description="Speed to contact and consistent follow up are the job. Here is what needs you." actions={<Link href="/leads/new"><Button variant="primary"><Plus className="h-4 w-4" />New lead</Button></Link>} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <Kpi label="Follow ups due today" value={data.followUpsDue} tone={data.followUpsDue > 0 ? "warn" : undefined} sub={data.overdue > 0 ? `${data.overdue} overdue` : "Nothing overdue"} />
        <Kpi label="Untouched leads" value={data.untouched} tone={data.untouched > 0 ? "bad" : "good"} sub="No contact attempt yet" />
        <Kpi label="New this week" value={data.newThisWeek} sub={`${data.openLeads} open in pipeline`} />
        <Kpi label="Offers out" value={data.offersSent} sub="Awaiting seller response" />
        <Kpi label="Under contract" value={data.contracts} tone="brand" sub="Contract and diligence" />
        <Kpi label="Closed" value={data.closed} tone="good" sub={speed ? `Avg first response ${speed < 60 ? `${Math.round(speed)} min` : `${(speed / 60).toFixed(1)} h`}` : "No response data yet"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Pipeline" description="Open leads by stage" actions={<Link href="/pipeline" className="text-xs text-brand hover:underline">Open board</Link>} />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {data.stages.map((s) => (
                <Link key={s.id} href={`/leads?stage=${s.key}`} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-surface-2 min-w-[140px]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color ?? "#9ca3af" }} />
                  <span className="text-[13px] text-fg-2 flex-1">{s.name}</span>
                  <span className="text-[13px] font-semibold num">{s.n}</span>
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="My follow ups" description="Due today or overdue" actions={<Link href="/tasks" className="text-xs text-brand hover:underline">All tasks</Link>} />
          <CardBody className="p-0">
            {tasks.length === 0 ? <div className="p-4"><EmptyState title="You are caught up" description="No follow ups due today." /></div> : (
              <ul className="divide-y divide-border">
                {tasks.map((t) => {
                  const due = dueLabel(t.dueAt);
                  return (
                    <li key={t.id} className="px-4 py-2.5 flex items-center gap-3">
                      <Phone className="h-4 w-4 text-fg-3 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium truncate">{t.title}</div>
                        <div className="text-xs text-fg-3 truncate">{t.address ? `${t.address}, ${t.city}` : "No lead"}</div>
                      </div>
                      <Badge tone={due.tone === "bad" ? "bad" : due.tone === "warn" ? "warn" : "neutral"}>{due.text}</Badge>
                      {t.leadId ? <Link href={`/leads/${t.leadId}`} className="text-xs text-brand hover:underline">Open</Link> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Newest open leads" description="Call these first" />
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {data.recent.map((r) => (
                <li key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/leads/${r.id}`} className="text-[13px] font-medium hover:underline truncate block">{r.address}, {r.city}</Link>
                    <div className="text-xs text-fg-3 truncate">{fullName({ firstName: r.first, lastName: r.last }) || "No contact"} · {r.assigned ?? "Unassigned"} · {relative(r.createdAt)}</div>
                  </div>
                  {r.contactAttempts === 0 ? <Badge tone="bad">Untouched</Badge> : <Badge tone="neutral">{r.contactAttempts} attempts</Badge>}
                  {r.stage ? <StageBadge name={r.stage.name} color={r.stage.color} /> : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Leads by source" description="All time" />
          <CardBody>
            <SourceChart data={data.bySource} />
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Team activity" description="Calls, texts, and emails logged in the last 7 days" />
          <CardBody>
            {data.teamActivity.length === 0 ? <p className="text-xs text-fg-3">No activity logged this week.</p> : (
              <div className="flex flex-wrap gap-3">
                {data.teamActivity.map((t) => (
                  <div key={t.actor} className="rounded-md border border-border px-3 py-2 min-w-[160px]">
                    <div className="text-xs text-fg-3">{t.actor}</div>
                    <div className="text-lg font-semibold num">{t.n}</div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
