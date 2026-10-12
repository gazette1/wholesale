import type { FormSummary } from "@/lib/forms/types";
import { Card, CardBody, CardHeader, Kpi } from "@/components/ui/card";
import { shortDate } from "@/lib/utils";

function NotAvailable({ reason }: { reason: string }) {
  return <p className="text-[13px] text-fg-3">Not available yet. {reason}</p>;
}

function WeeklyChart({ weeks }: { weeks: FormSummary["completionsPerWeek"] }) {
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const total = weeks.reduce((s, w) => s + w.count, 0);
  const W = 480, H = 130, pad = 18, base = H - 22;
  const slot = (W - pad * 2) / weeks.length;
  const barW = Math.min(26, slot - 6);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Completions per week for the last ${weeks.length} weeks, ${total} in total`} className="w-full h-auto max-h-40">
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="currentColor" strokeOpacity="0.2" />
        {weeks.map((w, i) => {
          const h = (w.count / max) * (base - 18);
          const x = pad + i * slot + (slot - barW) / 2;
          return (
            <g key={w.weekStart}>
              <title>{`Week of ${shortDate(w.weekStart)}: ${w.count} completed`}</title>
              <rect x={x} y={base - h} width={barW} height={Math.max(h, w.count > 0 ? 2 : 0)} rx="2" className="fill-brand" />
              {w.count > 0 ? <text x={x + barW / 2} y={base - h - 4} textAnchor="middle" fontSize="10" className="fill-fg-2">{w.count}</text> : null}
            </g>
          );
        })}
        <text x={pad} y={H - 6} fontSize="10" className="fill-fg-3">{shortDate(weeks[0]?.weekStart)}</text>
        <text x={W - pad} y={H - 6} fontSize="10" textAnchor="end" className="fill-fg-3">{shortDate(weeks[weeks.length - 1]?.weekStart)}</text>
      </svg>
      {total === 0 ? <p className="text-xs text-fg-3">No submission has been completed in these weeks.</p> : null}
    </div>
  );
}

function CountList({ rows, empty }: { rows: { label: string; count: number }[]; empty: string }) {
  if (!rows.length) return <p className="text-[13px] text-fg-3">{empty}</p>;
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((r) => <li key={r.label} className="flex items-center justify-between py-1.5 text-[13px]"><span className="truncate pr-3">{r.label}</span><span className="num font-medium">{r.count}</span></li>)}
    </ul>
  );
}

export function SummarySection({ summary }: { summary: FormSummary | null }) {
  if (!summary) {
    return <Card><CardBody><NotAvailable reason="The summary could not be built for this form." /></CardBody></Card>;
  }
  const anyAvg = summary.avgHoursBySection.some((s) => s.hours !== null);
  return (
    <section aria-label="Summary" className="space-y-3 mb-5">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <Kpi label="On track" value={summary.status.onTrack} tone="good" />
        <Kpi label="Due soon" value={summary.status.dueSoon} tone="warn" sub="Within 48 hours" />
        <Kpi label="Overdue" value={summary.status.overdue} tone="bad" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Completions per week" description="Submissions completed in the last 12 weeks" />
          <CardBody><WeeklyChart weeks={summary.completionsPerWeek} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Average time per section" description="From opening to completion" />
          <CardBody>
            {summary.avgHoursBySection.length === 0 ? <NotAvailable reason="This form has no sections." /> : (
              <>
                <ul className="divide-y divide-border/60">
                  {summary.avgHoursBySection.map((s) => (
                    <li key={s.sectionKey} className="flex items-center justify-between py-1.5 text-[13px]">
                      <span className="truncate pr-3">{s.title}</span>
                      {s.hours === null ? <span className="text-fg-3">Not available yet</span> : <span className="num font-medium">{s.hours} h <span className="text-fg-3 font-normal">({s.samples} {s.samples === 1 ? "section" : "sections"})</span></span>}
                    </li>
                  ))}
                </ul>
                {!anyAvg ? <p className="text-xs text-fg-3 mt-2">The average appears after a section has been completed at least once.</p> : null}
              </>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Open tasks by assignee" />
          <CardBody><CountList rows={summary.openByAssignee.map((a) => ({ label: a.name, count: a.count }))} empty="No open tasks are assigned to anyone." /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Open tasks by section" />
          <CardBody><CountList rows={summary.openBySection.map((a) => ({ label: a.title, count: a.count }))} empty="No sections have open tasks." /></CardBody>
        </Card>
      </div>
    </section>
  );
}
