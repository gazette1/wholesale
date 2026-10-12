import { and, eq, inArray, isNull, lte, gt, or, ne, notInArray } from "drizzle-orm";
import { alerts, forms, formComments, formSubmissions, formTaskAssignees, formTasks, formVersions, profiles } from "@dealcalc/db";
import { emailProvider, smsProvider, normalizePhone } from "@dealcalc/integrations";
import { parseDefinition } from "@dealcalc/forms";
import { getDb } from "../db";
import { isUuid } from "../safe";

type Db = Awaited<ReturnType<typeof getDb>>;

const DUE_SOON_HOURS = 24;
const ESCALATE_AFTER_HOURS = 48;
const BATCH = 500;

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export const taskLink = (taskId: string) => `${appUrl()}/forms/tasks/${taskId}`;

/**
 * Team notices go straight through the messaging boundary and are not written to a lead's messages thread.
 * That thread is the seller conversation: it drives consent, STOP handling, reply matching, and the lead's contact counters,
 * and none of that applies to a note sent to a teammate. Failures are logged and never thrown, so a bad number cannot block a workflow step.
 */
async function notifyProfile(db: Db, orgId: string, profileId: string, subject: string, text: string): Promise<boolean> {
  const p = await db.query.profiles.findFirst({ where: and(eq(profiles.id, profileId), eq(profiles.orgId, orgId), eq(profiles.active, true)) });
  if (!p) return false;
  let sent = false;
  try {
    if (p.notifyBy === "email" || p.notifyBy === "both") {
      if (p.email) {
        const r = await emailProvider().sendEmail({ to: p.email, subject, text });
        sent = sent || r.status !== "failed";
      }
    }
    if (p.notifyBy === "sms" || p.notifyBy === "both") {
      const to = normalizePhone(p.mobilePhone ?? p.phone ?? "");
      if (to) {
        const r = await smsProvider().sendSms({ to, body: `${subject}. ${text}` });
        sent = sent || r.status !== "failed";
      } else if (p.notifyBy === "sms" && p.email) {
        // SMS was chosen but no usable number is on file, so fall back to email rather than dropping the notice.
        const r = await emailProvider().sendEmail({ to: p.email, subject, text });
        sent = sent || r.status !== "failed";
      }
    }
  } catch (err) {
    console.error("[form notification]", err instanceof Error ? err.message : err);
  }
  return sent;
}

async function taskContext(db: Db, orgId: string, taskId: string) {
  if (!isUuid(orgId) || !isUuid(taskId)) return null;
  const task = await db.query.formTasks.findFirst({ where: and(eq(formTasks.id, taskId), eq(formTasks.orgId, orgId)) });
  if (!task) return null;
  const submission = await db.query.formSubmissions.findFirst({ where: and(eq(formSubmissions.id, task.submissionId), eq(formSubmissions.orgId, orgId)) });
  if (!submission) return null;
  const [form, version] = await Promise.all([
    db.query.forms.findFirst({ where: and(eq(forms.id, submission.formId), eq(forms.orgId, orgId)) }),
    db.query.formVersions.findFirst({ where: and(eq(formVersions.id, submission.versionId), eq(formVersions.orgId, orgId)) }),
  ]);
  let sectionTitle = task.sectionKey;
  try { sectionTitle = parseDefinition(version?.definition).sections.find((s) => s.key === task.sectionKey)?.title ?? sectionTitle; } catch { /* keep the key */ }
  return { task, submission, formName: form?.name ?? "Form", sectionTitle };
}

async function profileAssignees(db: Db, orgId: string, taskId: string): Promise<string[]> {
  const rows = await db.select({ profileId: formTaskAssignees.profileId }).from(formTaskAssignees)
    .where(and(eq(formTaskAssignees.orgId, orgId), eq(formTaskAssignees.taskId, taskId), isNull(formTaskAssignees.removedAt), isNull(formTaskAssignees.completedAt)));
  return [...new Set(rows.map((r) => r.profileId).filter((id): id is string => Boolean(id)))];
}

/** A section opened. Tells each internal assignee who has not finished it. External assignees got their link at invite time. */
export async function notifyTaskOpened(orgId: string, taskId: string): Promise<void> {
  const db = await getDb();
  const ctx = await taskContext(db, orgId, taskId);
  if (!ctx) return;
  const text = `${ctx.sectionTitle} on ${ctx.formName} is ready for you. Open it: ${taskLink(taskId)}`;
  for (const profileId of await profileAssignees(db, orgId, taskId)) await notifyProfile(db, orgId, profileId, `New task: ${ctx.formName}`, text);
}

/** A section was sent back for changes. */
export async function notifySentBack(orgId: string, taskId: string): Promise<void> {
  const db = await getDb();
  const ctx = await taskContext(db, orgId, taskId);
  if (!ctx) return;
  const text = `${ctx.sectionTitle} on ${ctx.formName} was sent back and needs changes. Open it: ${taskLink(taskId)}`;
  for (const profileId of await profileAssignees(db, orgId, taskId)) await notifyProfile(db, orgId, profileId, `Sent back: ${ctx.formName}`, text);
}

/** Notifies each profile mentioned in a comment, except its author. */
export async function notifyMentions(orgId: string, commentId: string): Promise<void> {
  if (!isUuid(commentId)) return;
  const db = await getDb();
  const comment = await db.query.formComments.findFirst({ where: and(eq(formComments.id, commentId), eq(formComments.orgId, orgId)) });
  if (!comment || !comment.taskId || comment.mentionIds.length === 0) return;
  const ctx = await taskContext(db, orgId, comment.taskId);
  if (!ctx) return;
  const ids = [...new Set(comment.mentionIds.filter(isUuid))].filter((id) => id !== comment.authorId);
  const text = `You were mentioned on ${ctx.sectionTitle} of ${ctx.formName}. Open it: ${taskLink(comment.taskId)}`;
  for (const profileId of ids) await notifyProfile(db, orgId, profileId, `Mention: ${ctx.formName}`, text);
}

type Threshold = "dueSoon" | "overdue" | "escalated";

/**
 * Finds open, unsnoozed tasks that crossed a threshold and handles each once.
 * Due soon: due within 24 hours. Overdue: past due. Escalated: more than 48 hours past due, sent to the org admins.
 * A threshold column is claimed with a conditional update before anything is sent, so a repeat or overlapping run cannot double send.
 * Alerts carry dedupe keys as well, so the bell stays clean even if a column were reset.
 */
export async function runFormReminders(orgId?: string, now: Date = new Date()): Promise<{ dueSoon: number; overdue: number; escalated: number }> {
  const db = await getDb();
  const counts = { dueSoon: 0, overdue: 0, escalated: 0 };

  const base = (extra: ReturnType<typeof and>[]) => and(
    eq(formTasks.status, "open"), isNull(formTasks.archivedAt), or(isNull(formTasks.snoozedUntil), lte(formTasks.snoozedUntil, now)),
    notInArray(formSubmissions.status, ["completed", "archived", "draft"]), isNull(formSubmissions.archivedAt),
    ...(orgId ? [eq(formTasks.orgId, orgId)] : []), ...extra,
  );
  const select = () => db.select({ taskId: formTasks.id, orgId: formTasks.orgId, dueAt: formTasks.dueAt, leadId: formSubmissions.leadId })
    .from(formTasks).innerJoin(formSubmissions, eq(formTasks.submissionId, formSubmissions.id));

  const soonCutoff = new Date(now.getTime() + DUE_SOON_HOURS * 3_600_000);
  const escalateCutoff = new Date(now.getTime() - ESCALATE_AFTER_HOURS * 3_600_000);

  const passes: { kind: Threshold; rows: Promise<{ taskId: string; orgId: string; dueAt: Date | null; leadId: string | null }[]> }[] = [
    { kind: "dueSoon", rows: select().where(base([gt(formTasks.dueAt, now), lte(formTasks.dueAt, soonCutoff), isNull(formTasks.dueSoonNotifiedAt)])).limit(BATCH) },
    { kind: "overdue", rows: select().where(base([lte(formTasks.dueAt, now), isNull(formTasks.overdueNotifiedAt)])).limit(BATCH) },
    { kind: "escalated", rows: select().where(base([lte(formTasks.dueAt, escalateCutoff), isNull(formTasks.escalatedAt)])).limit(BATCH) },
  ];

  for (const pass of passes) {
    let rows: Awaited<typeof pass.rows> = [];
    try { rows = await pass.rows; } catch (err) { console.error("[form reminders]", err instanceof Error ? err.message : err); continue; }
    for (const row of rows) {
      try {
        if (await handleThreshold(db, pass.kind, row, now)) counts[pass.kind] += 1;
      } catch (err) {
        console.error("[form reminders]", err instanceof Error ? err.message : err);
      }
    }
  }
  return counts;
}

async function handleThreshold(db: Db, kind: Threshold, row: { taskId: string; orgId: string; dueAt: Date | null; leadId: string | null }, now: Date): Promise<boolean> {
  const column = kind === "dueSoon" ? formTasks.dueSoonNotifiedAt : kind === "overdue" ? formTasks.overdueNotifiedAt : formTasks.escalatedAt;
  const stamp = kind === "dueSoon" ? { dueSoonNotifiedAt: now } : kind === "overdue" ? { overdueNotifiedAt: now } : { escalatedAt: now };
  const [claimed] = await db.update(formTasks).set(stamp).where(and(eq(formTasks.id, row.taskId), eq(formTasks.orgId, row.orgId), isNull(column))).returning();
  if (!claimed) return false;

  const ctx = await taskContext(db, row.orgId, row.taskId);
  if (!ctx) return false;
  const due = row.dueAt ? row.dueAt.toLocaleString("en-US", { timeZone: "America/New_York" }) : "";
  const link = taskLink(row.taskId);

  let recipients: string[];
  let alertKind: "form_due_soon" | "form_overdue" | "form_escalation";
  let title: string;
  let body: string;
  if (kind === "escalated") {
    const admins = await db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.orgId, row.orgId), eq(profiles.role, "admin"), eq(profiles.active, true)));
    recipients = admins.map((a) => a.id);
    alertKind = "form_escalation";
    title = "Form task is more than 2 days overdue";
    body = `${ctx.sectionTitle} on ${ctx.formName} was due ${due}.`;
  } else {
    recipients = await profileAssignees(db, row.orgId, row.taskId);
    alertKind = kind === "dueSoon" ? "form_due_soon" : "form_overdue";
    title = kind === "dueSoon" ? "Form task is due soon" : "Form task is overdue";
    body = kind === "dueSoon" ? `${ctx.sectionTitle} on ${ctx.formName} is due ${due}.` : `${ctx.sectionTitle} on ${ctx.formName} was due ${due}.`;
  }

  for (const profileId of recipients) {
    await db.insert(alerts).values({
      orgId: row.orgId, leadId: row.leadId, recipientId: profileId, kind: alertKind, title, body, formTaskId: row.taskId, dedupeKey: `${alertKind}:${row.taskId}:${profileId}`,
    }).onConflictDoNothing();
    await notifyProfile(db, row.orgId, profileId, title, `${body} Open it: ${link}`);
  }
  return true;
}
