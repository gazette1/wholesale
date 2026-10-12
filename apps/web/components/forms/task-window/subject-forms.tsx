import Link from "next/link";
import { listSubmissionsForLead, listSubmissionsForBuyer, listStartableForms, getMyFormTasks } from "@/lib/data/forms";
import type { SubmissionRow } from "@/lib/forms/types";
import { can, type Session } from "@/lib/auth";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { shortDate } from "@/lib/utils";
import { SUBMISSION_STATUS } from "./format";
import { StartForm } from "./start-form";

const HEALTH: Record<string, { label: string; tone: BadgeTone }> = {
  on_track: { label: "On track", tone: "good" },
  due_soon: { label: "Due soon", tone: "warn" },
  overdue: { label: "Overdue", tone: "bad" },
};

function humanize(key: string): string {
  const t = key.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Forms for one lead or buyer: its submissions, the person's own open tasks on it, and a control to start a form.
 * Reads form data only. No deal numbers are loaded here, so a buyer page never carries contract price, spread, MAO, or fee.
 */
export async function SubjectForms({ session, subject }: { session: Session; subject: { kind: "lead" | "buyer"; id: string } }) {
  const [rows, startable, mine] = await Promise.all([
    subject.kind === "lead" ? listSubmissionsForLead(session.orgId, subject.id) : listSubmissionsForBuyer(session.orgId, subject.id),
    can(session, "form:fill") ? listStartableForms(session.orgId, subject.kind, session.role) : Promise.resolve([]),
    getMyFormTasks(session.orgId, session.profileId),
  ]);
  const ids = new Set(rows.map((r) => r.id));
  const myTasks = [...mine.open, ...mine.approvals].filter((t) => ids.has(t.submissionId));
  const titles = new Map(myTasks.map((t) => [`${t.submissionId}:${t.sectionKey}`, t.sectionTitle]));

  const openTask = (r: SubmissionRow) => r.tasks.find((t) => t.status === "open");

  return (
    <div className="space-y-4">
      {can(session, "form:fill") ? (
        <Card>
          <CardHeader title="Start a form" description="Forms are filled in by the people who own each section." />
          <CardBody><StartForm subject={subject} forms={startable} /></CardBody>
        </Card>
      ) : null}

      {myTasks.length ? (
        <Card>
          <CardHeader title="Your open tasks" />
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {myTasks.map((t) => (
                <li key={t.taskId} className="px-4 py-2.5 flex items-center justify-between gap-3 text-[13px]">
                  <Link href={`/forms/tasks/${t.taskId}`} className="min-w-0 truncate hover:underline">{t.formName}: {t.sectionTitle}</Link>
                  <span className="flex items-center gap-2 shrink-0">
                    {t.unread ? <Badge tone="brand">New</Badge> : null}
                    {t.needsApproval ? <Badge tone="warn">Approval</Badge> : null}
                    {t.dueAt ? <span className={t.overdue ? "text-xs text-bad" : "text-xs text-fg-3"}>Due {shortDate(t.dueAt)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Submissions" description={subject.kind === "lead" ? "Forms started for this lead." : "Forms started for this buyer."} />
        <CardBody className="p-0 overflow-x-auto">
          {rows.length === 0 ? <p className="p-4 text-[13px] text-fg-3">No forms have been started yet.</p> : (
            <Table>
              <THead><tr><TH>Form</TH><TH>Status</TH><TH>Current section</TH><TH>Due</TH><TH>Started</TH><TH></TH></tr></THead>
              <TBody>
                {rows.map((r) => {
                  const open = openTask(r);
                  const st = SUBMISSION_STATUS[r.status];
                  const health = r.health ? HEALTH[r.health] : null;
                  return (
                    <TR key={r.id}>
                      <TD className="font-medium">{r.title || r.formName}{r.editedAfterCompletion ? <span className="ml-2"><Badge tone="warn">Edited after completion</Badge></span> : null}</TD>
                      <TD><span className="flex items-center gap-1.5"><Badge tone={st.tone}>{st.label}</Badge>{health && r.health !== "on_track" ? <Badge tone={health.tone}>{health.label}</Badge> : null}</span></TD>
                      <TD className="text-fg-3">{open ? (open.sectionTitle || titles.get(`${r.id}:${open.sectionKey}`) || humanize(open.sectionKey)) : r.status === "completed" ? "Finished" : ""}{open && open.assigneeNames.length ? ` · ${open.assigneeNames.join(", ")}` : ""}</TD>
                      <TD className="text-fg-3">{r.dueAt ? shortDate(r.dueAt) : ""}</TD>
                      <TD className="text-fg-3">{shortDate(r.createdAt)}{r.startedByName ? ` by ${r.startedByName}` : ""}</TD>
                      <TD>{open ? <Link href={`/forms/tasks/${open.taskId}`} className="text-brand hover:underline" aria-label={`Open task for ${r.title || r.formName}`}>Open task</Link> : null}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
