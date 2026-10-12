/** Read queries for Workflow Forms. Every query is scoped by orgId. */
import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  forms, formVersions, formSubmissions, formTasks, formTaskAssignees, formEvents, formExternalParties, profiles, leads, properties, buyers, documents,
} from "@dealcalc/db";
import { parseDefinition, orderedSections, orderedFields, choiceLabels, formSettingsSchema, type FormDefinition, type FormSettings } from "@dealcalc/forms";
import { getDb, type Db } from "../db";
import { isUuid } from "../safe";
import { recordsToCsv } from "../csv";
import type { FormActor } from "../forms/actor";
import type {
  FormLibraryRow, FormLibraryFilters, FormDetail, SubmissionRow, SubmissionReport, SubmissionFilters, FormSummary, MyTasks, MyTaskRow,
  SubmissionStatus, SubjectType, SubmissionTaskState, FormStatus,
} from "../forms/types";

const OPEN_STATUSES: SubmissionStatus[] = ["draft", "in_progress", "waiting_approval", "sent_back"];
const DUE_SOON_MS = 48 * 3_600_000;
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function settingsOf(raw: unknown): FormSettings {
  return formSettingsSchema.parse(raw ?? {});
}

/** A task counts as late only while it is not snoozed. */
function activeDue(t: { status: string; dueAt: Date | null; snoozedUntil: Date | null }, now: number): number | null {
  if (t.status !== "open" || !t.dueAt) return null;
  if (t.snoozedUntil && t.snoozedUntil.getTime() > now) return null;
  return t.dueAt.getTime();
}

function healthOf(status: SubmissionStatus, tasks: { status: string; dueAt: Date | null; snoozedUntil: Date | null }[], now: number): SubmissionRow["health"] {
  if (!OPEN_STATUSES.includes(status)) return null;
  const dues = tasks.map((t) => activeDue(t, now)).filter((d): d is number => d !== null);
  if (!dues.length) return "on_track";
  const first = Math.min(...dues);
  if (first < now) return "overdue";
  if (first < now + DUE_SOON_MS) return "due_soon";
  return "on_track";
}

/* --------------------------------- library --------------------------------- */

export async function listFormLibrary(orgId: string, f: FormLibraryFilters = {}): Promise<FormLibraryRow[]> {
  const db = await getDb();
  const conds = [eq(forms.orgId, orgId)];
  const status: FormStatus | "all" = f.status ?? "all";
  if (status === "all") conds.push(sql`${forms.status} <> 'archived'`);
  else conds.push(eq(forms.status, status));
  if (f.q?.trim()) conds.push(ilike(forms.name, `%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
  if (f.category) conds.push(eq(forms.category, f.category));
  if (f.ownerId && isUuid(f.ownerId)) conds.push(eq(forms.ownerId, f.ownerId));
  const rows = await db.select({ form: forms, ownerName: profiles.fullName, versionNumber: formVersions.number })
    .from(forms)
    .leftJoin(profiles, eq(profiles.id, forms.ownerId))
    .leftJoin(formVersions, eq(formVersions.id, forms.latestVersionId))
    .where(and(...conds)).orderBy(asc(forms.name));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.form.id);
  const subs = await db.select({ id: formSubmissions.id, formId: formSubmissions.formId }).from(formSubmissions)
    .where(and(eq(formSubmissions.orgId, orgId), inArray(formSubmissions.formId, ids), inArray(formSubmissions.status, OPEN_STATUSES), isNull(formSubmissions.archivedAt)));
  const openCount = new Map<string, number>();
  for (const s of subs) openCount.set(s.formId, (openCount.get(s.formId) ?? 0) + 1);
  const now = new Date();
  const late = subs.length ? await db.select({ submissionId: formTasks.submissionId, formId: formSubmissions.formId }).from(formTasks)
    .innerJoin(formSubmissions, eq(formSubmissions.id, formTasks.submissionId))
    .where(and(eq(formTasks.orgId, orgId), eq(formTasks.status, "open"), lte(formTasks.dueAt, now), or(isNull(formTasks.snoozedUntil), lte(formTasks.snoozedUntil, now)), inArray(formSubmissions.id, subs.map((s) => s.id)))) : [];
  const overdue = new Map<string, Set<string>>();
  for (const l of late) { if (!overdue.has(l.formId)) overdue.set(l.formId, new Set()); overdue.get(l.formId)!.add(l.submissionId); }
  return rows.map((r) => ({
    id: r.form.id, name: r.form.name, category: r.form.category, description: r.form.description, status: r.form.status as FormStatus,
    ownerId: r.form.ownerId, ownerName: r.ownerName ?? null, latestVersionNumber: r.versionNumber ?? null, subjectType: settingsOf(r.form.settings).subjectType as SubjectType,
    openCount: openCount.get(r.form.id) ?? 0, overdueCount: overdue.get(r.form.id)?.size ?? 0, lastUsedAt: iso(r.form.lastUsedAt), archivedAt: iso(r.form.archivedAt),
  }));
}

export async function listFormCategories(orgId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.selectDistinct({ c: forms.category }).from(forms).where(and(eq(forms.orgId, orgId), sql`${forms.category} is not null`)).orderBy(asc(forms.category));
  return rows.map((r) => r.c!).filter(Boolean);
}

/** Published forms a person can start for a lead or buyer, for the Start a form menu. */
export async function listStartableForms(orgId: string, subjectType: "lead" | "buyer" | "none", role: string): Promise<{ id: string; name: string; category: string | null }[]> {
  const db = await getDb();
  const rows = await db.select().from(forms).where(and(eq(forms.orgId, orgId), eq(forms.status, "published"), isNull(forms.archivedAt))).orderBy(asc(forms.name));
  return rows.filter((r) => {
    const s = settingsOf(r.settings);
    if (s.subjectType !== subjectType) return false;
    if (role === "admin") return true;
    return s.whoMayStart.length === 0 ? role !== "viewer" : s.whoMayStart.includes(role as never);
  }).map((r) => ({ id: r.id, name: r.name, category: r.category }));
}

export async function getFormDetail(orgId: string, formId: string): Promise<FormDetail | null> {
  if (!isUuid(formId)) return null;
  const db = await getDb();
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, formId), eq(forms.orgId, orgId)) });
  if (!form) return null;
  const owner = form.ownerId ? await db.query.profiles.findFirst({ where: and(eq(profiles.id, form.ownerId), eq(profiles.orgId, orgId)) }) : undefined;
  const versions = await db.select({ id: formVersions.id, number: formVersions.number, publishedAt: formVersions.publishedAt, by: profiles.fullName })
    .from(formVersions).leftJoin(profiles, eq(profiles.id, formVersions.publishedBy))
    .where(and(eq(formVersions.formId, formId), eq(formVersions.orgId, orgId))).orderBy(desc(formVersions.number));
  const latest = versions.find((v) => v.id === form.latestVersionId);
  const published = form.latestVersionId ? await db.query.formVersions.findFirst({ where: and(eq(formVersions.id, form.latestVersionId), eq(formVersions.orgId, orgId)) }) : undefined;
  return {
    publishedDefinition: published?.definition ?? null,
    id: form.id, name: form.name, description: form.description, category: form.category, status: form.status as FormStatus, ownerId: form.ownerId, ownerName: owner?.fullName ?? null,
    settings: settingsOf(form.settings), templateSlug: form.templateSlug, draftDefinition: form.draftDefinition, latestVersionId: form.latestVersionId,
    latestVersionNumber: latest?.number ?? null, versions: versions.map((v) => ({ id: v.id, number: v.number, publishedAt: v.publishedAt.toISOString(), publishedByName: v.by ?? null })),
    archivedAt: iso(form.archivedAt), lastUsedAt: iso(form.lastUsedAt),
  };
}

/** The definition submissions currently follow, or the draft when nothing is published. */
async function latestDefinition(db: Db, orgId: string, form: typeof forms.$inferSelect): Promise<{ def: FormDefinition | null; number: number | null }> {
  if (form.latestVersionId) {
    const v = await db.query.formVersions.findFirst({ where: and(eq(formVersions.id, form.latestVersionId), eq(formVersions.orgId, orgId)) });
    if (v) return { def: parseDefinition(v.definition), number: v.number };
  }
  try { return { def: parseDefinition(form.draftDefinition), number: null }; } catch { return { def: null, number: null }; }
}

/* ------------------------------- submissions ------------------------------- */

async function buildRows(db: Db, orgId: string, subs: (typeof formSubmissions.$inferSelect)[], opts: { withAnswers: boolean }): Promise<SubmissionRow[]> {
  if (!subs.length) return [];
  const now = Date.now();
  const subIds = subs.map((s) => s.id);
  const formIds = [...new Set(subs.map((s) => s.formId))];
  const versionIds = [...new Set(subs.map((s) => s.versionId))];
  const leadIds = [...new Set(subs.map((s) => s.leadId).filter((x): x is string => !!x))];
  const buyerIds = [...new Set(subs.map((s) => s.buyerId).filter((x): x is string => !!x))];
  const starterIds = [...new Set(subs.map((s) => s.startedBy).filter((x): x is string => !!x))];
  const [formRows, versionRows, tasks, leadRows, buyerRows, starters] = await Promise.all([
    db.select({ id: forms.id, name: forms.name }).from(forms).where(and(eq(forms.orgId, orgId), inArray(forms.id, formIds))),
    db.select({ id: formVersions.id, number: formVersions.number, definition: formVersions.definition }).from(formVersions).where(and(eq(formVersions.orgId, orgId), inArray(formVersions.id, versionIds))),
    db.select().from(formTasks).where(and(eq(formTasks.orgId, orgId), inArray(formTasks.submissionId, subIds), isNull(formTasks.archivedAt))),
    leadIds.length ? db.select({ id: leads.id, a: properties.addressLine1, c: properties.city, s: properties.state }).from(leads).innerJoin(properties, eq(properties.id, leads.propertyId)).where(and(eq(leads.orgId, orgId), inArray(leads.id, leadIds))) : Promise.resolve([]),
    buyerIds.length ? db.select().from(buyers).where(and(eq(buyers.orgId, orgId), inArray(buyers.id, buyerIds))) : Promise.resolve([]),
    starterIds.length ? db.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(and(eq(profiles.orgId, orgId), inArray(profiles.id, starterIds))) : Promise.resolve([]),
  ]);
  const taskIds = tasks.map((t) => t.id);
  const assigneeRows = taskIds.length ? await db.select({ taskId: formTaskAssignees.taskId, name: profiles.fullName, partyName: formExternalParties.name, partyEmail: formExternalParties.email })
    .from(formTaskAssignees)
    .leftJoin(profiles, eq(profiles.id, formTaskAssignees.profileId))
    .leftJoin(formExternalParties, eq(formExternalParties.id, formTaskAssignees.externalPartyId))
    .where(and(eq(formTaskAssignees.orgId, orgId), inArray(formTaskAssignees.taskId, taskIds), isNull(formTaskAssignees.removedAt))) : [];
  const namesByTask = new Map<string, string[]>();
  for (const a of assigneeRows) {
    const n = a.name ?? a.partyName ?? a.partyEmail ?? "External party";
    namesByTask.set(a.taskId, [...(namesByTask.get(a.taskId) ?? []), n]);
  }
  const formName = new Map(formRows.map((f) => [f.id, f.name]));
  const versionNumber = new Map(versionRows.map((v) => [v.id, v.number]));
  const sectionTitles = new Map(versionRows.map((v) => [v.id, new Map(((v.definition.sections ?? []) as { key?: string; title?: string }[]).map((x) => [String(x.key), String(x.title ?? x.key)]))]));
  const leadLabel = new Map(leadRows.map((l) => [l.id, `${l.a}, ${l.c}, ${l.s}`]));
  const buyerLabel = new Map(buyerRows.map((b) => [b.id, [b.firstName, b.lastName].filter(Boolean).join(" ").trim() || b.company || "Buyer"]));
  const starterName = new Map(starters.map((s) => [s.id, s.name]));
  return subs.map((s) => {
    const own = tasks.filter((t) => t.submissionId === s.id);
    const order = new Map<string, number>();
    const taskStates: SubmissionTaskState[] = own.sort((a, b) => (a.openedAt?.getTime() ?? Infinity) - (b.openedAt?.getTime() ?? Infinity)).map((t) => ({
      taskId: t.id, sectionKey: t.sectionKey, sectionTitle: sectionTitles.get(s.versionId)?.get(t.sectionKey) ?? t.sectionKey, roleKey: t.roleKey, status: t.status, dueAt: iso(t.dueAt), snoozedUntil: iso(t.snoozedUntil), completedAt: iso(t.completedAt),
      approvalOutcome: t.approvalOutcome, assigneeNames: namesByTask.get(t.id) ?? [],
    }));
    void order;
    return {
      id: s.id, formId: s.formId, formName: formName.get(s.formId) ?? "Form", versionNumber: versionNumber.get(s.versionId) ?? 0, title: s.title, status: s.status as SubmissionStatus,
      subjectType: s.subjectType as SubjectType, leadId: s.leadId, buyerId: s.buyerId,
      subjectLabel: s.leadId ? (leadLabel.get(s.leadId) ?? null) : s.buyerId ? (buyerLabel.get(s.buyerId) ?? null) : null,
      startedByName: s.startedBy ? (starterName.get(s.startedBy) ?? null) : null, createdAt: s.createdAt.toISOString(), completedAt: iso(s.completedAt), dueAt: iso(s.dueAt),
      editedAfterCompletion: s.editedAfterCompletion, health: healthOf(s.status as SubmissionStatus, own, now), answers: opts.withAnswers ? (s.answers ?? {}) : {}, tasks: taskStates,
    };
  });
}

/** Rows for the report table: one per submission, with answers and per task state. */
export async function getSubmissionReport(orgId: string, formId: string, f: SubmissionFilters = {}): Promise<SubmissionReport | null> {
  if (!isUuid(formId)) return null;
  const db = await getDb();
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, formId), eq(forms.orgId, orgId)) });
  if (!form) return null;
  const conds = [eq(formSubmissions.orgId, orgId), eq(formSubmissions.formId, formId)];
  const status = f.status ?? "all";
  if (status === "open") conds.push(inArray(formSubmissions.status, OPEN_STATUSES));
  else if (status === "all") conds.push(isNull(formSubmissions.archivedAt));
  else conds.push(eq(formSubmissions.status, status));
  if (f.q?.trim()) conds.push(ilike(formSubmissions.title, `%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
  const limit = Math.min(Math.max(f.limit ?? 500, 1), 2000);
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(formSubmissions).where(and(...conds));
  const subs = await db.select().from(formSubmissions).where(and(...conds)).orderBy(desc(formSubmissions.createdAt)).limit(limit);
  const { def, number } = await latestDefinition(db, orgId, form);
  const fields = def ? orderedFields(def).filter((p) => p.field.type !== "content").map((p) => ({ key: p.field.key, label: p.field.label, type: p.field.type, sectionKey: p.section.key, sectionTitle: p.section.title })) : [];
  return { form: { id: form.id, name: form.name, versionNumber: number }, fields, rows: await buildRows(db, orgId, subs, { withAnswers: true }), total: n };
}

export async function listSubmissionsForLead(orgId: string, leadId: string): Promise<SubmissionRow[]> {
  if (!isUuid(leadId)) return [];
  const db = await getDb();
  const subs = await db.select().from(formSubmissions).where(and(eq(formSubmissions.orgId, orgId), eq(formSubmissions.leadId, leadId), isNull(formSubmissions.archivedAt))).orderBy(desc(formSubmissions.createdAt));
  return buildRows(db, orgId, subs, { withAnswers: false });
}

export async function listSubmissionsForBuyer(orgId: string, buyerId: string): Promise<SubmissionRow[]> {
  if (!isUuid(buyerId)) return [];
  const db = await getDb();
  const subs = await db.select().from(formSubmissions).where(and(eq(formSubmissions.orgId, orgId), eq(formSubmissions.buyerId, buyerId), isNull(formSubmissions.archivedAt))).orderBy(desc(formSubmissions.createdAt));
  return buildRows(db, orgId, subs, { withAnswers: false });
}

/* --------------------------------- summary --------------------------------- */

function weekStartUtc(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  return x;
}

export async function getFormSummary(orgId: string, formId: string): Promise<FormSummary | null> {
  if (!isUuid(formId)) return null;
  const db = await getDb();
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, formId), eq(forms.orgId, orgId)) });
  if (!form) return null;
  const { def } = await latestDefinition(db, orgId, form);
  const titles = new Map((def ? orderedSections(def) : []).map((s) => [s.key, s.title]));
  const now = Date.now();
  const subs = await db.select().from(formSubmissions).where(and(eq(formSubmissions.orgId, orgId), eq(formSubmissions.formId, formId), isNull(formSubmissions.archivedAt)));
  const tasks = subs.length ? await db.select().from(formTasks).where(and(eq(formTasks.orgId, orgId), inArray(formTasks.submissionId, subs.map((s) => s.id)), isNull(formTasks.archivedAt))) : [];

  const status = { onTrack: 0, dueSoon: 0, overdue: 0 };
  for (const s of subs) {
    const h = healthOf(s.status as SubmissionStatus, tasks.filter((t) => t.submissionId === s.id), now);
    if (h === "on_track") status.onTrack++; else if (h === "due_soon") status.dueSoon++; else if (h === "overdue") status.overdue++;
  }

  const thisWeek = weekStartUtc(new Date());
  const weeks: { weekStart: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(thisWeek); d.setUTCDate(d.getUTCDate() - i * 7); weeks.push({ weekStart: d.toISOString().slice(0, 10), count: 0 }); }
  for (const s of subs) {
    if (s.status !== "completed" || !s.completedAt) continue;
    const key = weekStartUtc(s.completedAt).toISOString().slice(0, 10);
    const w = weeks.find((x) => x.weekStart === key);
    if (w) w.count++;
  }

  const openTasks = tasks.filter((t) => t.status === "open" && subs.find((s) => s.id === t.submissionId && OPEN_STATUSES.includes(s.status as SubmissionStatus)));
  const bySection = new Map<string, number>();
  for (const t of openTasks) bySection.set(t.sectionKey, (bySection.get(t.sectionKey) ?? 0) + 1);
  const assigneeRows = openTasks.length ? await db.select({ profileId: formTaskAssignees.profileId, name: profiles.fullName }).from(formTaskAssignees)
    .innerJoin(profiles, eq(profiles.id, formTaskAssignees.profileId))
    .where(and(eq(formTaskAssignees.orgId, orgId), inArray(formTaskAssignees.taskId, openTasks.map((t) => t.id)), isNull(formTaskAssignees.removedAt), isNull(formTaskAssignees.completedAt))) : [];
  const byAssignee = new Map<string, { name: string; count: number }>();
  for (const a of assigneeRows) { const k = a.profileId!; const cur = byAssignee.get(k) ?? { name: a.name, count: 0 }; cur.count++; byAssignee.set(k, cur); }

  const sectionKeys = def ? orderedSections(def).map((s) => s.key) : [...new Set(tasks.map((t) => t.sectionKey))];
  const avg = sectionKeys.map((key) => {
    const done = tasks.filter((t) => t.sectionKey === key && t.status === "completed" && t.openedAt && t.completedAt);
    const hours = done.length ? done.reduce((sum, t) => sum + (t.completedAt!.getTime() - t.openedAt!.getTime()) / 3_600_000, 0) / done.length : null;
    return { sectionKey: key, title: titles.get(key) ?? key, hours: hours === null ? null : Math.round(hours * 10) / 10, samples: done.length };
  });

  return {
    status, completionsPerWeek: weeks,
    openByAssignee: [...byAssignee.entries()].map(([profileId, v]) => ({ profileId, name: v.name, count: v.count })).sort((a, b) => b.count - a.count),
    openBySection: [...bySection.entries()].map(([sectionKey, count]) => ({ sectionKey, title: titles.get(sectionKey) ?? sectionKey, count })),
    avgHoursBySection: avg,
  };
}

/* --------------------------------- my tasks --------------------------------- */

export async function getMyFormTasks(orgId: string, profileId: string): Promise<MyTasks> {
  const empty: MyTasks = { open: [], approvals: [], snoozed: [], unreadCount: 0 };
  if (!isUuid(profileId)) return empty;
  const db = await getDb();
  const rows = await db.select({ task: formTasks, seenAt: formTaskAssignees.seenAt, sub: formSubmissions, formName: forms.name, versionId: formSubmissions.versionId })
    .from(formTaskAssignees)
    .innerJoin(formTasks, eq(formTasks.id, formTaskAssignees.taskId))
    .innerJoin(formSubmissions, eq(formSubmissions.id, formTasks.submissionId))
    .innerJoin(forms, eq(forms.id, formSubmissions.formId))
    .where(and(eq(formTaskAssignees.orgId, orgId), eq(formTaskAssignees.profileId, profileId), isNull(formTaskAssignees.removedAt), isNull(formTaskAssignees.completedAt),
      eq(formTasks.status, "open"), isNull(formTasks.archivedAt), isNull(formSubmissions.archivedAt)))
    .orderBy(asc(formTasks.dueAt));
  if (!rows.length) return empty;
  const taskIds = rows.map((r) => r.task.id);
  const lastEvents = await db.select({ taskId: formEvents.taskId, at: sql<Date>`max(${formEvents.at})` }).from(formEvents)
    .where(and(eq(formEvents.orgId, orgId), inArray(formEvents.taskId, taskIds))).groupBy(formEvents.taskId);
  const lastAt = new Map(lastEvents.map((e) => [e.taskId!, new Date(e.at as unknown as string).getTime()]));
  const versionIds = [...new Set(rows.map((r) => r.versionId))];
  const versions = await db.select().from(formVersions).where(and(eq(formVersions.orgId, orgId), inArray(formVersions.id, versionIds)));
  const defs = new Map(versions.map((v) => [v.id, parseDefinition(v.definition)]));
  const labels = await subjectLabels(db, orgId, rows.map((r) => r.sub));
  const now = Date.now();
  const out: MyTasks = { open: [], approvals: [], snoozed: [], unreadCount: 0 };
  for (const r of rows) {
    const section = defs.get(r.versionId)?.sections.find((s) => s.key === r.task.sectionKey);
    const snoozed = !!r.task.snoozedUntil && r.task.snoozedUntil.getTime() > now;
    const last = lastAt.get(r.task.id) ?? 0;
    const unread = !r.seenAt || r.seenAt.getTime() < last;
    const row: MyTaskRow = {
      taskId: r.task.id, submissionId: r.sub.id, formId: r.sub.formId, formName: r.formName, sectionKey: r.task.sectionKey, sectionTitle: section?.title ?? r.task.sectionKey,
      subjectLabel: labels.get(r.sub.id) ?? null, needsApproval: section?.needsApproval === true, status: r.task.status, dueAt: iso(r.task.dueAt), snoozedUntil: iso(r.task.snoozedUntil),
      overdue: !snoozed && !!r.task.dueAt && r.task.dueAt.getTime() < now, unread,
    };
    if (snoozed) out.snoozed.push(row);
    else {
      (row.needsApproval ? out.approvals : out.open).push(row);
      if (unread) out.unreadCount++;
    }
  }
  return out;
}

async function subjectLabels(db: Db, orgId: string, subs: (typeof formSubmissions.$inferSelect)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const leadIds = [...new Set(subs.map((s) => s.leadId).filter((x): x is string => !!x))];
  const buyerIds = [...new Set(subs.map((s) => s.buyerId).filter((x): x is string => !!x))];
  const [leadRows, buyerRows] = await Promise.all([
    leadIds.length ? db.select({ id: leads.id, a: properties.addressLine1, c: properties.city, s: properties.state }).from(leads).innerJoin(properties, eq(properties.id, leads.propertyId)).where(and(eq(leads.orgId, orgId), inArray(leads.id, leadIds))) : Promise.resolve([]),
    buyerIds.length ? db.select().from(buyers).where(and(eq(buyers.orgId, orgId), inArray(buyers.id, buyerIds))) : Promise.resolve([]),
  ]);
  const lead = new Map(leadRows.map((l) => [l.id, `${l.a}, ${l.c}, ${l.s}`]));
  const buyer = new Map(buyerRows.map((b) => [b.id, [b.firstName, b.lastName].filter(Boolean).join(" ").trim() || b.company || "Buyer"]));
  for (const s of subs) {
    const label = (s.leadId && lead.get(s.leadId)) || (s.buyerId && buyer.get(s.buyerId));
    if (label) out.set(s.id, label);
  }
  return out;
}

/** Records that the actor opened the task, which clears its unread mark. */
export async function markTaskSeen(actor: FormActor, taskId: string): Promise<void> {
  if (!isUuid(taskId)) return;
  const db = await getDb();
  const who = actor.kind === "profile" ? eq(formTaskAssignees.profileId, actor.profileId) : eq(formTaskAssignees.externalPartyId, actor.partyId);
  await db.update(formTaskAssignees).set({ seenAt: new Date() }).where(and(eq(formTaskAssignees.orgId, actor.orgId), eq(formTaskAssignees.taskId, taskId), who));
}

/* ----------------------------------- CSV ----------------------------------- */

function cell(value: unknown, field: { type: string; key: string }, labels: Record<string, Record<string, string>>, people: Map<string, string>, files: Map<string, string>): string {
  if (value === null || value === undefined || value === "") return "";
  const list = Array.isArray(value) ? value : [value];
  switch (field.type) {
    case "yes_no": return value === true ? "Yes" : value === false ? "No" : String(value);
    case "single_choice":
    case "multiple_choice": return list.map((v) => labels[field.key]?.[String(v)] ?? String(v)).join("; ");
    case "person": return list.map((v) => people.get(String(v)) ?? "Removed").join("; ");
    case "file_upload": return list.map((v) => files.get(String(v)) ?? "File").join("; ");
    default: return list.join("; ");
  }
}

export async function formSubmissionsCsv(orgId: string, formId: string): Promise<string | null> {
  if (!isUuid(formId)) return null;
  const db = await getDb();
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, formId), eq(forms.orgId, orgId)) });
  if (!form) return null;
  const report = await getSubmissionReport(orgId, formId, { status: "all", limit: 2000 });
  if (!report) return null;
  const { def } = await latestDefinition(db, orgId, form);
  const labels = def ? choiceLabels(def) : {};
  const personIds = new Set<string>(); const fileIds = new Set<string>();
  for (const row of report.rows) for (const f of report.fields) {
    const v = row.answers[f.key];
    const list = Array.isArray(v) ? v : v == null ? [] : [v];
    if (f.type === "person") list.forEach((x) => personIds.add(String(x)));
    if (f.type === "file_upload") list.forEach((x) => fileIds.add(String(x)));
  }
  const valid = (ids: Set<string>) => [...ids].filter((i) => isUuid(i));
  const people = new Map<string, string>();
  const files = new Map<string, string>();
  if (personIds.size) for (const p of await db.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(and(eq(profiles.orgId, orgId), inArray(profiles.id, valid(personIds))))) people.set(p.id, p.name);
  if (fileIds.size) for (const d of await db.select({ id: documents.id, name: documents.filename }).from(documents).where(and(eq(documents.orgId, orgId), inArray(documents.id, valid(fileIds))))) files.set(d.id, d.name);

  const fixed = ["Submission", "Subject", "Status", "Started by", "Started", "Completed", "Due", "Edited after completion"];
  const columns = [...fixed, ...report.fields.map((f) => f.label)];
  const seen = new Map<string, number>();
  const unique = columns.map((c) => { const n = (seen.get(c) ?? 0) + 1; seen.set(c, n); return n === 1 ? c : `${c} (${n})`; });
  const records = report.rows.map((row) => {
    const rec: Record<string, unknown> = {
      [unique[0]!]: row.title ?? row.id, [unique[1]!]: row.subjectLabel ?? "", [unique[2]!]: row.status.replace(/_/g, " "), [unique[3]!]: row.startedByName ?? "",
      [unique[4]!]: row.createdAt, [unique[5]!]: row.completedAt ?? "", [unique[6]!]: row.dueAt ?? "", [unique[7]!]: row.editedAfterCompletion ? "Yes" : "No",
    };
    report.fields.forEach((f, i) => { rec[unique[fixed.length + i]!] = cell(row.answers[f.key], f, labels, people, files); });
    return rec;
  });
  return recordsToCsv(unique, records);
}

