/**
 * Workflow Forms services. Every function takes an actor so the signed in app and the external fill page share one code path.
 * Services throw Error with a plain message for permission and state problems, and return structured errors for validation.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  forms, formVersions, formSubmissions, formTasks, formTaskAssignees, formComments, formEvents, formExternalParties,
  profiles, leads, properties, buyers, activities, documents,
} from "@dealcalc/db";
import {
  parseDefinition, validateDefinition, evaluate, validateSection, validateAnswer, resolveRole, computeDueAt, migrateAnswers,
  orderedSections, nextSectionsToOpen, allSectionsDone, isTaskComplete, sortByOrder, findField, formSettingsSchema,
  FORM_TEMPLATES, isEmptyValue, normalizeText,
  type AppRole, type FieldDef, type FormDefinition, type FormSettings, type SectionState, type EvaluationContext,
  type FieldError, type DefinitionError, type CompletionRule, type SectionDef,
} from "@dealcalc/forms";
import { getDb, type Db } from "../db";
import { isUuid } from "../safe";
import type { FormActor, ProfileActor, ExternalActor } from "../forms/actor";
import type { TaskWindowData, TaskEvaluation, TaskCommentView, TaskHistoryView, TaskAssigneeView, SubmissionStatus } from "../forms/types";
import { storeFormFile } from "./form-files";
import { notifyTaskOpened, notifySentBack, notifyMentions } from "./form-notifications";

type FormRow = typeof forms.$inferSelect;
type SubmissionRow = typeof formSubmissions.$inferSelect;
type TaskRow = typeof formTasks.$inferSelect;
type AssigneeRow = typeof formTaskAssignees.$inferSelect;

type Loaded = {
  sub: SubmissionRow;
  form: FormRow;
  version: typeof formVersions.$inferSelect;
  def: FormDefinition;
  settings: FormSettings;
  starterRole: AppRole | undefined;
  subjectOwnerId: string | null;
};
type TaskCtx = Loaded & { task: TaskRow; assignees: AssigneeRow[]; section: SectionDef | undefined };

const EMPTY_DEFINITION = { schemaVersion: 1, roles: [], sections: [], rules: [] };
const MAX_VALUE_CHARS = 20_000;

/* ----------------------------- small helpers ----------------------------- */

async function safely(label: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch (err) { console.error(`[forms] ${label} failed`, err); }
}

function assertAdmin(actor: ProfileActor): void {
  if (!actor.isFormAdmin) throw new Error("Only form admins can do this.");
}
function assertWriter(actor: FormActor): void {
  if (actor.kind === "profile" && actor.role === "viewer") throw new Error("Your role (viewer) is read only.");
}
const isoOrNull = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function parseSettings(raw: unknown): FormSettings {
  return formSettingsSchema.parse(raw ?? {});
}

function evalContext(l: Loaded, now: Date): EvaluationContext {
  return { starterRole: l.starterRole, versionNumber: l.version.number, createdAt: l.sub.createdAt, now, timeZone: l.settings.timeZone };
}

async function loadSubmission(db: Db, orgId: string, submissionId: string): Promise<Loaded | null> {
  if (!isUuid(submissionId)) return null;
  const sub = await db.query.formSubmissions.findFirst({ where: and(eq(formSubmissions.id, submissionId), eq(formSubmissions.orgId, orgId)) });
  if (!sub) return null;
  const [form, version, starter, lead] = await Promise.all([
    db.query.forms.findFirst({ where: and(eq(forms.id, sub.formId), eq(forms.orgId, orgId)) }),
    db.query.formVersions.findFirst({ where: and(eq(formVersions.id, sub.versionId), eq(formVersions.orgId, orgId)) }),
    sub.startedBy ? db.query.profiles.findFirst({ where: and(eq(profiles.id, sub.startedBy), eq(profiles.orgId, orgId)) }) : Promise.resolve(undefined),
    sub.leadId ? db.query.leads.findFirst({ where: and(eq(leads.id, sub.leadId), eq(leads.orgId, orgId)) }) : Promise.resolve(undefined),
  ]);
  if (!form || !version) return null;
  return {
    sub, form, version, def: parseDefinition(version.definition), settings: parseSettings(form.settings),
    starterRole: starter?.role, subjectOwnerId: lead?.assignedTo ?? null,
  };
}

async function loadTask(db: Db, orgId: string, taskId: string): Promise<TaskCtx | null> {
  if (!isUuid(taskId)) return null;
  const task = await db.query.formTasks.findFirst({ where: and(eq(formTasks.id, taskId), eq(formTasks.orgId, orgId), isNull(formTasks.archivedAt)) });
  if (!task) return null;
  const l = await loadSubmission(db, orgId, task.submissionId);
  if (!l) return null;
  const assignees = await db.select().from(formTaskAssignees).where(and(eq(formTaskAssignees.taskId, task.id), eq(formTaskAssignees.orgId, orgId), isNull(formTaskAssignees.removedAt)));
  return { ...l, task, assignees, section: l.def.sections.find((s) => s.key === task.sectionKey) };
}

async function writeEvent(db: Db, actor: FormActor | null, e: {
  orgId: string; formId: string; submissionId: string; taskId?: string | null; kind: typeof formEvents.$inferInsert["kind"];
  fieldKey?: string | null; before?: unknown; after?: unknown; versionId?: string | null;
}): Promise<void> {
  await db.insert(formEvents).values({
    orgId: e.orgId, formId: e.formId, submissionId: e.submissionId, taskId: e.taskId ?? null,
    actorId: actor?.kind === "profile" ? actor.profileId : null,
    actorExternalPartyId: actor?.kind === "external" ? actor.partyId : null,
    actorLabel: actor ? actor.label : "System",
    kind: e.kind, fieldKey: e.fieldKey ?? null, before: (e.before ?? null) as never, after: (e.after ?? null) as never, versionId: e.versionId ?? null,
  });
}

async function logActivity(db: Db, actor: FormActor | null, l: Loaded, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (!l.sub.leadId) return;
  await db.insert(activities).values({
    orgId: l.sub.orgId, leadId: l.sub.leadId, actorId: actor?.kind === "profile" ? actor.profileId : null, type: "form",
    payload: { text, formId: l.form.id, formName: l.form.name, submissionId: l.sub.id, ...extra },
  });
}

async function notifyOpened(orgId: string, taskIds: string[]): Promise<void> {
  for (const id of taskIds) await safely("notifyTaskOpened", () => notifyTaskOpened(orgId, id));
}

async function activeProfiles(db: Db, orgId: string): Promise<{ id: string; role: AppRole }[]> {
  return db.select({ id: profiles.id, role: profiles.role }).from(profiles).where(and(eq(profiles.orgId, orgId), eq(profiles.active, true)));
}

async function validProfileIds(db: Db, orgId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter((i) => isUuid(i)))];
  if (!unique.length) return [];
  const rows = await db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.orgId, orgId), eq(profiles.active, true), inArray(profiles.id, unique)));
  return rows.map((r) => r.id);
}

async function subjectLabelFor(db: Db, orgId: string, leadId: string | null, buyerId: string | null): Promise<string | null> {
  if (leadId) {
    const [row] = await db.select({ a: properties.addressLine1, c: properties.city, s: properties.state }).from(leads)
      .innerJoin(properties, eq(properties.id, leads.propertyId)).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId))).limit(1);
    return row ? `${row.a}, ${row.c}, ${row.s}` : null;
  }
  if (buyerId) {
    const b = await db.query.buyers.findFirst({ where: and(eq(buyers.id, buyerId), eq(buyers.orgId, orgId)) });
    if (!b) return null;
    const name = [b.firstName, b.lastName].filter(Boolean).join(" ").trim();
    return name || b.company || null;
  }
  return null;
}

/* ------------------------- access and field visibility ------------------------- */

type Access = { isAssignee: boolean; isAdmin: boolean; allowedSection: boolean; myAssignee: AssigneeRow | undefined };

function accessFor(actor: FormActor, tc: TaskCtx): Access {
  if (actor.kind === "profile") {
    const mine = tc.assignees.find((a) => a.profileId === actor.profileId);
    return { isAssignee: !!mine, isAdmin: actor.isFormAdmin, allowedSection: true, myAssignee: mine };
  }
  const mine = tc.assignees.find((a) => a.externalPartyId === actor.partyId);
  const allowed = actor.submissionId === tc.sub.id && actor.sectionKeys.includes(tc.task.sectionKey) && tc.section?.allowExternal === true;
  return { isAssignee: !!mine, isAdmin: false, allowedSection: allowed, myAssignee: mine };
}

/** Role keys the profile holds in this submission, from its task assignments. */
async function heldRoleKeys(db: Db, actor: FormActor, submissionId: string): Promise<Set<string>> {
  if (actor.kind !== "profile") return new Set();
  const rows = await db.select({ roleKey: formTasks.roleKey }).from(formTaskAssignees)
    .innerJoin(formTasks, eq(formTasks.id, formTaskAssignees.taskId))
    .where(and(eq(formTaskAssignees.orgId, actor.orgId), eq(formTaskAssignees.profileId, actor.profileId), isNull(formTaskAssignees.removedAt), eq(formTasks.submissionId, submissionId)));
  return new Set(rows.map((r) => r.roleKey).filter((k): k is string => !!k));
}

function canSeeField(field: FieldDef, actor: FormActor, held: Set<string>): boolean {
  if (actor.kind === "external") return field.visibleToExternal;
  if (actor.isFormAdmin) return true;
  return field.visibleToRoles.length === 0 || field.visibleToRoles.some((r) => held.has(r));
}

/* ------------------------------ value handling ------------------------------ */

function normalizeValue(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (value === undefined) return { ok: false };
  if (isEmptyValue(value)) return { ok: true, value: null };
  if (typeof value === "string") return value.length <= MAX_VALUE_CHARS ? { ok: true, value } : { ok: false };
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (typeof value === "boolean") return { ok: true, value };
  if (Array.isArray(value) && value.length <= 500 && value.every((v) => (typeof v === "string" && v.length <= 2000) || typeof v === "number" || typeof v === "boolean")) return { ok: true, value };
  return { ok: false };
}

/** Person values must be active profiles of the org. File values must be documents of this submission. */
async function checkReferences(db: Db, orgId: string, submissionId: string | null, field: FieldDef, value: unknown): Promise<string | null> {
  if (value === null) return null;
  const list = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string");
  if (field.type === "person") {
    const ok = await validProfileIds(db, orgId, list);
    return ok.length === list.length ? null : "Choose people from the team list";
  }
  if (field.type === "file_upload") {
    if (!list.every((v) => isUuid(v))) return "Upload files through the file picker";
    if (!submissionId) return "Files cannot be attached yet";
    const rows = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.orgId, orgId), eq(documents.submissionId, submissionId), inArray(documents.id, list)));
    return rows.length === new Set(list).size ? null : "Upload files through the file picker";
  }
  return null;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/* ------------------------------ forms: building ------------------------------ */

export type CreateFormInput = {
  name: string;
  category?: string | null;
  description?: string | null;
  from?: { kind: "blank" } | { kind: "copy"; formId: string } | { kind: "template"; slug: string };
  settings?: Partial<FormSettings>;
};

export async function createForm(actor: ProfileActor, input: CreateFormInput): Promise<{ id: string }> {
  assertAdmin(actor);
  const db = await getDb();
  const name = input.name.trim();
  if (!name) throw new Error("Enter a form name.");
  let definition: unknown = EMPTY_DEFINITION;
  let settings: FormSettings = parseSettings(input.settings ?? {});
  let category = input.category?.trim() || null;
  let description = input.description?.trim() || null;
  let templateSlug: string | null = null;
  const from = input.from ?? { kind: "blank" as const };
  if (from.kind === "template") {
    const t = FORM_TEMPLATES.find((x) => x.slug === from.slug);
    if (!t) throw new Error("That template was not found.");
    definition = t.definition;
    settings = parseSettings({ ...t.settings, ...input.settings });
    category = category ?? t.category;
    description = description ?? t.description;
    templateSlug = t.slug;
  } else if (from.kind === "copy") {
    if (!isUuid(from.formId)) throw new Error("Form not found.");
    const src = await db.query.forms.findFirst({ where: and(eq(forms.id, from.formId), eq(forms.orgId, actor.orgId)) });
    if (!src) throw new Error("Form not found.");
    definition = src.draftDefinition;
    settings = parseSettings({ ...src.settings, ...input.settings });
    category = category ?? src.category;
    description = description ?? src.description;
    templateSlug = src.templateSlug;
  }
  const [row] = await db.insert(forms).values({
    orgId: actor.orgId, name: name.slice(0, 200), category: category?.slice(0, 80) ?? null, description: description?.slice(0, 2000) ?? null,
    status: "draft", ownerId: actor.profileId, draftDefinition: definition as never, settings, templateSlug,
  }).returning();
  return { id: row!.id };
}

export async function duplicateForm(actor: ProfileActor, formId: string): Promise<{ id: string }> {
  assertAdmin(actor);
  const db = await getDb();
  if (!isUuid(formId)) throw new Error("Form not found.");
  const src = await db.query.forms.findFirst({ where: and(eq(forms.id, formId), eq(forms.orgId, actor.orgId)) });
  if (!src) throw new Error("Form not found.");
  return createForm(actor, { name: `${src.name} (copy)`, from: { kind: "copy", formId } });
}

/** Stores the draft even when it has errors, so work is never lost. Returns the errors for the editor. */
export async function saveDraftDefinition(actor: ProfileActor, formId: string, definition: unknown): Promise<{ errors: DefinitionError[] }> {
  assertAdmin(actor);
  const db = await getDb();
  if (!isUuid(formId)) throw new Error("Form not found.");
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, formId), eq(forms.orgId, actor.orgId)) });
  if (!form) throw new Error("Form not found.");
  if (form.archivedAt) throw new Error("Restore this form before editing it.");
  if (definition === null || typeof definition !== "object" || Array.isArray(definition)) throw new Error("The form definition is not valid.");
  if (JSON.stringify(definition).length > 2_000_000) throw new Error("The form is too large to save.");
  const validation = validateDefinition(definition);
  let toStore: unknown = definition;
  try { toStore = parseDefinition(definition); } catch { /* keep the raw draft so the editor can reopen it */ }
  await db.update(forms).set({ draftDefinition: toStore as never }).where(and(eq(forms.id, formId), eq(forms.orgId, actor.orgId)));
  return { errors: validation.errors };
}

export async function updateFormDetails(actor: ProfileActor, formId: string, patch: {
  name?: string; category?: string | null; description?: string | null; ownerId?: string | null; settings?: Partial<FormSettings>;
}): Promise<void> {
  assertAdmin(actor);
  const db = await getDb();
  if (!isUuid(formId)) throw new Error("Form not found.");
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, formId), eq(forms.orgId, actor.orgId)) });
  if (!form) throw new Error("Form not found.");
  const set: Partial<typeof forms.$inferInsert> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error("Enter a form name.");
    set.name = n.slice(0, 200);
  }
  if (patch.category !== undefined) set.category = patch.category?.trim().slice(0, 80) || null;
  if (patch.description !== undefined) set.description = patch.description?.trim().slice(0, 2000) || null;
  if (patch.ownerId !== undefined) {
    if (patch.ownerId === null) set.ownerId = null;
    else {
      const ok = await validProfileIds(db, actor.orgId, [patch.ownerId]);
      if (!ok.length) throw new Error("That team member was not found.");
      set.ownerId = patch.ownerId;
    }
  }
  if (patch.settings) {
    const merged = parseSettings({ ...(form.settings ?? {}), ...patch.settings });
    try { new Intl.DateTimeFormat("en-US", { timeZone: merged.timeZone }); } catch { throw new Error("That time zone is not recognized."); }
    set.settings = merged;
  }
  if (Object.keys(set).length) await db.update(forms).set(set).where(and(eq(forms.id, formId), eq(forms.orgId, actor.orgId)));
}

/** Archive hides the form from the library and from Start a form. Submissions and history stay. */
export async function archiveForm(actor: ProfileActor, formId: string): Promise<void> {
  assertAdmin(actor);
  const db = await getDb();
  if (!isUuid(formId)) throw new Error("Form not found.");
  const res = await db.update(forms).set({ status: "archived", archivedAt: new Date() }).where(and(eq(forms.id, formId), eq(forms.orgId, actor.orgId))).returning();
  if (!res.length) throw new Error("Form not found.");
}

export async function restoreForm(actor: ProfileActor, formId: string): Promise<void> {
  assertAdmin(actor);
  const db = await getDb();
  if (!isUuid(formId)) throw new Error("Form not found.");
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, formId), eq(forms.orgId, actor.orgId)) });
  if (!form) throw new Error("Form not found.");
  await db.update(forms).set({ status: form.latestVersionId ? "published" : "draft", archivedAt: null }).where(and(eq(forms.id, formId), eq(forms.orgId, actor.orgId)));
}

/* ------------------------------- publish and migrate ------------------------------- */

export type PublishResult = { ok: true; versionNumber: number; migrated: number } | { ok: false; errors: DefinitionError[] };

export async function publishForm(actor: ProfileActor, formId: string): Promise<PublishResult> {
  assertAdmin(actor);
  const db = await getDb();
  if (!isUuid(formId)) throw new Error("Form not found.");
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, formId), eq(forms.orgId, actor.orgId)) });
  if (!form) throw new Error("Form not found.");
  if (form.archivedAt) throw new Error("Restore this form before publishing it.");
  const validation = validateDefinition(form.draftDefinition);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  const def = parseDefinition(form.draftDefinition);
  const versions = await db.select().from(formVersions).where(and(eq(formVersions.formId, formId), eq(formVersions.orgId, actor.orgId))).orderBy(desc(formVersions.number));
  const latest = versions[0];
  if (latest && sameJson(latest.definition, def)) throw new Error(`The draft matches version ${latest.number}. Change it before publishing.`);
  const number = (latest?.number ?? 0) + 1;
  const [version] = await db.insert(formVersions).values({ orgId: actor.orgId, formId, number, definition: def as never, publishedBy: actor.profileId }).returning();
  await db.update(forms).set({ latestVersionId: version!.id, status: "published", archivedAt: null }).where(and(eq(forms.id, formId), eq(forms.orgId, actor.orgId)));

  // Submissions always follow the latest version.
  const subs = await db.select().from(formSubmissions).where(and(eq(formSubmissions.formId, formId), eq(formSubmissions.orgId, actor.orgId), isNull(formSubmissions.archivedAt)));
  const defCache = new Map<string, FormDefinition>(versions.map((v) => [v.id, parseDefinition(v.definition)]));
  const newKeys = new Set(def.sections.map((s) => s.key));
  let migrated = 0;
  for (const sub of subs) {
    const oldDef = defCache.get(sub.versionId) ?? def;
    const { answers, retired } = migrateAnswers(oldDef, def, sub.answers ?? {});
    await db.update(formSubmissions).set({ versionId: version!.id, answers }).where(eq(formSubmissions.id, sub.id));
    await writeEvent(db, actor, {
      orgId: actor.orgId, formId, submissionId: sub.id, kind: "version_migrated", before: retired,
      after: { fromVersionId: sub.versionId, toVersionId: version!.id, toNumber: number }, versionId: version!.id,
    });
    const tasks = await db.select().from(formTasks).where(and(eq(formTasks.submissionId, sub.id), isNull(formTasks.archivedAt)));
    for (const t of tasks) {
      if (!newKeys.has(t.sectionKey) && (t.status === "open" || t.status === "not_started")) {
        await db.update(formTasks).set({ status: "skipped" }).where(eq(formTasks.id, t.id));
        await writeEvent(db, actor, { orgId: actor.orgId, formId, submissionId: sub.id, taskId: t.id, kind: "section_skipped", after: { sectionKey: t.sectionKey, reason: "section removed" } });
      }
    }
    const opened = await advance(db, actor, actor.orgId, sub.id);
    await notifyOpened(actor.orgId, opened);
    migrated++;
  }
  return { ok: true, versionNumber: number, migrated };
}

/* --------------------------------- submissions --------------------------------- */

export type StartSubmissionInput = {
  formId: string;
  leadId?: string | null;
  buyerId?: string | null;
  answers?: Record<string, unknown>;
  title?: string | null;
};

async function sanitizePrefill(db: Db, orgId: string, def: FormDefinition, raw: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    const field = findField(def, key);
    if (!field || field.type === "content" || field.type === "file_upload" || field.type === "signature") continue;
    const n = normalizeValue(value);
    if (!n.ok || n.value === null) continue;
    if (validateAnswer(field, n.value, raw)) continue;
    if (await checkReferences(db, orgId, null, field, n.value)) continue;
    out[key] = n.value;
  }
  return out;
}

export async function startSubmission(actor: ProfileActor, input: StartSubmissionInput): Promise<{ id: string; leadId: string | null; buyerId: string | null; firstTaskIds: string[] }> {
  assertWriter(actor);
  const db = await getDb();
  if (!isUuid(input.formId)) throw new Error("Form not found.");
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, input.formId), eq(forms.orgId, actor.orgId)) });
  if (!form || form.archivedAt || form.status !== "published" || !form.latestVersionId) throw new Error("That form is not published.");
  const settings = parseSettings(form.settings);
  const allowed = settings.whoMayStart;
  if (actor.role !== "admin" && !actor.isFormAdmin) {
    if (allowed.length === 0 ? actor.role === "viewer" : !allowed.includes(actor.role)) throw new Error("Your role cannot start this form.");
  }
  const version = await db.query.formVersions.findFirst({ where: and(eq(formVersions.id, form.latestVersionId), eq(formVersions.orgId, actor.orgId)) });
  if (!version) throw new Error("That form is not published.");
  const def = parseDefinition(version.definition);

  let leadId: string | null = null;
  let buyerId: string | null = null;
  if (settings.subjectType === "lead") {
    if (!input.leadId || !isUuid(input.leadId)) throw new Error("Choose the lead this form is for.");
    const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), eq(leads.orgId, actor.orgId)) });
    if (!lead) throw new Error("Lead not found.");
    leadId = lead.id;
  } else if (settings.subjectType === "buyer") {
    if (!input.buyerId || !isUuid(input.buyerId)) throw new Error("Choose the buyer this form is for.");
    const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, input.buyerId), eq(buyers.orgId, actor.orgId)) });
    if (!buyer) throw new Error("Buyer not found.");
    buyerId = buyer.id;
  }
  const label = await subjectLabelFor(db, actor.orgId, leadId, buyerId);
  const title = (input.title?.trim() || (label ? `${form.name}: ${label}` : form.name)).slice(0, 300);
  const answers = await sanitizePrefill(db, actor.orgId, def, input.answers);

  const [sub] = await db.insert(formSubmissions).values({
    orgId: actor.orgId, formId: form.id, versionId: version.id, subjectType: settings.subjectType, leadId, buyerId, title,
    status: "in_progress", answers, startedBy: actor.profileId,
  }).returning();
  await db.update(forms).set({ lastUsedAt: new Date() }).where(eq(forms.id, form.id));
  const l = (await loadSubmission(db, actor.orgId, sub!.id))!;
  await writeEvent(db, actor, { orgId: actor.orgId, formId: form.id, submissionId: sub!.id, kind: "submission_started", after: { versionNumber: version.number, subjectType: settings.subjectType, leadId, buyerId }, versionId: version.id });
  await logActivity(db, actor, l, `Started form: ${form.name}`, { event: "started" });
  const opened = await advance(db, actor, actor.orgId, sub!.id);
  await notifyOpened(actor.orgId, opened);
  return { id: sub!.id, leadId, buyerId, firstTaskIds: opened };
}

/** A visitor on a public link starts their own submission. The party row comes from createPublicLink. */
export async function startPublicSubmission(input: { orgId: string; formId: string; partyId: string; label: string }): Promise<{ submissionId: string; taskIds: string[] }> {
  const db = await getDb();
  if (!isUuid(input.formId) || !isUuid(input.partyId)) throw new Error("This link is not valid.");
  const party = await db.query.formExternalParties.findFirst({ where: and(eq(formExternalParties.id, input.partyId), eq(formExternalParties.orgId, input.orgId), eq(formExternalParties.formId, input.formId)) });
  if (!party || party.kind !== "public" || party.revokedAt || party.archivedAt) throw new Error("This link is not valid.");
  if (party.submissionId) return { submissionId: party.submissionId, taskIds: [] };
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, input.formId), eq(forms.orgId, input.orgId)) });
  if (!form || form.archivedAt || form.status !== "published" || !form.latestVersionId) throw new Error("This form is not available.");
  const settings = parseSettings(form.settings);
  if (!settings.allowPublicLink) throw new Error("This form is not available.");
  const version = await db.query.formVersions.findFirst({ where: and(eq(formVersions.id, form.latestVersionId), eq(formVersions.orgId, input.orgId)) });
  if (!version) throw new Error("This form is not available.");
  const def = parseDefinition(version.definition);
  const [sub] = await db.insert(formSubmissions).values({
    orgId: input.orgId, formId: form.id, versionId: version.id, subjectType: "none", title: form.name.slice(0, 300), status: "in_progress", answers: {}, startedByExternalPartyId: party.id,
  }).returning();
  const sectionKeys = party.sectionKeys.length ? party.sectionKeys : def.sections.filter((s) => s.allowExternal).map((s) => s.key);
  await db.update(formExternalParties).set({ submissionId: sub!.id, sectionKeys }).where(eq(formExternalParties.id, party.id));
  await db.update(forms).set({ lastUsedAt: new Date() }).where(eq(forms.id, form.id));
  const actor: ExternalActor = { kind: "external", orgId: input.orgId, partyId: party.id, label: input.label, submissionId: sub!.id, sectionKeys };
  await writeEvent(db, actor, { orgId: input.orgId, formId: form.id, submissionId: sub!.id, kind: "submission_started", after: { versionNumber: version.number, via: "public_link" }, versionId: version.id });
  const opened = await advance(db, actor, input.orgId, sub!.id);
  await notifyOpened(input.orgId, opened);
  return { submissionId: sub!.id, taskIds: opened };
}

/* ------------------------------ sections and tasks ------------------------------ */

async function resolveAssignees(db: Db, l: Loaded, answers: Record<string, unknown>, roleKey: string, sectionKey: string): Promise<{ profileIds: string[]; externalIds: string[] }> {
  const role = l.def.roles.find((r) => r.key === roleKey);
  const active = await activeProfiles(db, l.sub.orgId);
  const profilesByRole: Partial<Record<AppRole, string[]>> = {};
  for (const p of active) (profilesByRole[p.role] ??= []).push(p.id);
  const parties = await db.select({ id: formExternalParties.id, sectionKeys: formExternalParties.sectionKeys, expiresAt: formExternalParties.expiresAt }).from(formExternalParties)
    .where(and(eq(formExternalParties.orgId, l.sub.orgId), eq(formExternalParties.submissionId, l.sub.id), isNull(formExternalParties.revokedAt), isNull(formExternalParties.archivedAt)));
  const nowMs = Date.now();
  const eligible = parties.filter((p) => p.sectionKeys.includes(sectionKey) && (!p.expiresAt || p.expiresAt.getTime() > nowMs));
  const resolved = role
    ? resolveRole(role, { answers, subjectOwnerId: l.subjectOwnerId, starterId: l.sub.startedBy, profilesByRole, externalPartyIds: eligible.map((p) => p.id) })
    : { source: null, profileIds: [] as string[], externalPartyIds: [] as string[] };
  const valid = new Set(active.map((p) => p.id));
  let profileIds = resolved.profileIds.filter((id) => valid.has(id));
  const externalIds = resolved.externalPartyIds;
  // A task nobody owns can never finish, so fall back to the starter, then the form owner.
  if (!profileIds.length && !externalIds.length && !role?.resolution.some((r) => r.kind === "external")) {
    const fallback = [l.sub.startedBy, l.form.ownerId].find((id): id is string => !!id && valid.has(id));
    if (fallback) profileIds = [fallback];
  }
  return { profileIds, externalIds };
}

async function ensureAssignee(db: Db, orgId: string, taskId: string, who: { profileId?: string; externalPartyId?: string }): Promise<boolean> {
  const cond = who.profileId ? eq(formTaskAssignees.profileId, who.profileId) : eq(formTaskAssignees.externalPartyId, who.externalPartyId!);
  const existing = await db.query.formTaskAssignees.findFirst({ where: and(eq(formTaskAssignees.orgId, orgId), eq(formTaskAssignees.taskId, taskId), cond) });
  if (existing) {
    if (!existing.removedAt) return false;
    await db.update(formTaskAssignees).set({ removedAt: null, completedAt: null }).where(eq(formTaskAssignees.id, existing.id));
    return true;
  }
  await db.insert(formTaskAssignees).values({ orgId, taskId, profileId: who.profileId ?? null, externalPartyId: who.externalPartyId ?? null });
  return true;
}

/** Called by the invite flow when it adds an external assignee to an open section. */
export async function addExternalAssignee(orgId: string, submissionId: string, sectionKey: string, partyId: string): Promise<void> {
  const db = await getDb();
  const task = await db.query.formTasks.findFirst({ where: and(eq(formTasks.orgId, orgId), eq(formTasks.submissionId, submissionId), eq(formTasks.sectionKey, sectionKey), isNull(formTasks.archivedAt)) });
  if (task && task.status === "open") await ensureAssignee(db, orgId, task.id, { externalPartyId: partyId });
}

async function openSection(db: Db, actor: FormActor | null, l: Loaded, sectionKey: string, ev: ReturnType<typeof evaluate>, existing: TaskRow | undefined, previousCompletedAt: Date | null, now: Date): Promise<string | null> {
  const section = l.def.sections.find((s) => s.key === sectionKey);
  if (!section) return null;
  const roleKey = ev.assignments[sectionKey] ?? section.ownerRole;
  const dueRule = ev.dueRules[sectionKey];
  const dueAt = dueRule ? computeDueAt(dueRule, { now, timeZone: l.settings.timeZone, submissionStartedAt: l.sub.createdAt, previousSectionCompletedAt: previousCompletedAt, answers: ev.answers }) : null;
  const values = {
    status: "open" as const, roleKey, completionRule: section.completionRule.type, minimumCount: section.completionRule.count ?? null,
    dueAt, openedAt: now, completedAt: null,
  };
  let taskId: string;
  if (existing) {
    await db.update(formTasks).set({ ...values, approvalOutcome: null }).where(eq(formTasks.id, existing.id));
    taskId = existing.id;
  } else {
    const [row] = await db.insert(formTasks).values({ orgId: l.sub.orgId, submissionId: l.sub.id, sectionKey, ...values }).returning();
    taskId = row!.id;
  }
  const { profileIds, externalIds } = await resolveAssignees(db, l, ev.answers, roleKey, sectionKey);
  for (const id of profileIds) await ensureAssignee(db, l.sub.orgId, taskId, { profileId: id });
  for (const id of externalIds) await ensureAssignee(db, l.sub.orgId, taskId, { externalPartyId: id });
  await writeEvent(db, actor, { orgId: l.sub.orgId, formId: l.form.id, submissionId: l.sub.id, taskId, kind: "section_opened", after: { sectionKey, roleKey, profileIds, externalPartyIds: externalIds, dueAt: isoOrNull(dueAt) } });
  await logActivity(db, actor, l, `Form section opened: ${l.form.name}, ${section.title}`, { event: "section_opened", sectionKey });
  return taskId;
}

/** Opens or skips whatever the flow now allows, then refreshes the submission status. Returns the ids of tasks opened. */
async function advance(db: Db, actor: FormActor | null, orgId: string, submissionId: string): Promise<string[]> {
  const l = await loadSubmission(db, orgId, submissionId);
  if (!l || l.sub.archivedAt) return [];
  const now = new Date();
  const tasks = await db.select().from(formTasks).where(and(eq(formTasks.submissionId, submissionId), eq(formTasks.orgId, orgId), isNull(formTasks.archivedAt)));
  const state: Record<string, SectionState> = {};
  for (const t of tasks) state[t.sectionKey] = t.status;
  const ev = evaluate(l.def, l.sub.answers ?? {}, evalContext(l, now));
  const { open, skip } = nextSectionsToOpen(l.def, state, ev);
  const times = tasks.map((t) => t.completedAt?.getTime()).filter((t): t is number => typeof t === "number");
  const previousCompletedAt = times.length ? new Date(Math.max(...times)) : null;
  const opened: string[] = [];
  for (const key of skip) {
    const existing = tasks.find((t) => t.sectionKey === key);
    let taskId: string;
    if (existing) { await db.update(formTasks).set({ status: "skipped" }).where(eq(formTasks.id, existing.id)); taskId = existing.id; }
    else { const [r] = await db.insert(formTasks).values({ orgId, submissionId, sectionKey: key, status: "skipped" }).returning(); taskId = r!.id; }
    await writeEvent(db, actor, { orgId, formId: l.form.id, submissionId, taskId, kind: "section_skipped", after: { sectionKey: key, reason: "rules" } });
  }
  for (const key of open) {
    const id = await openSection(db, actor, l, key, ev, tasks.find((t) => t.sectionKey === key), previousCompletedAt, now);
    if (id) opened.push(id);
  }
  await recomputeStatus(db, actor, orgId, submissionId);
  return opened;
}

async function recomputeStatus(db: Db, actor: FormActor | null, orgId: string, submissionId: string): Promise<void> {
  const l = await loadSubmission(db, orgId, submissionId);
  if (!l || l.sub.archivedAt) return;
  const tasks = await db.select().from(formTasks).where(and(eq(formTasks.submissionId, submissionId), eq(formTasks.orgId, orgId), isNull(formTasks.archivedAt)));
  const state: Record<string, SectionState> = {};
  for (const t of tasks) state[t.sectionKey] = t.status;
  const approvalKeys = new Set(l.def.sections.filter((s) => s.needsApproval).map((s) => s.key));
  const openTasks = tasks.filter((t) => t.status === "open");
  let status: SubmissionStatus;
  if (openTasks.some((t) => t.returnToSectionKey)) status = "sent_back";
  else if (allSectionsDone(l.def, state)) status = "completed";
  else if (openTasks.some((t) => approvalKeys.has(t.sectionKey))) status = "waiting_approval";
  else status = "in_progress";
  const dues = openTasks.map((t) => t.dueAt?.getTime()).filter((t): t is number => typeof t === "number");
  const dueAt = dues.length ? new Date(Math.min(...dues)) : null;
  const wasCompleted = l.sub.status === "completed";
  await db.update(formSubmissions).set({
    status, dueAt, completedAt: status === "completed" ? (l.sub.completedAt ?? new Date()) : null,
  }).where(eq(formSubmissions.id, submissionId));
  if (status === "completed" && !wasCompleted) await logActivity(db, actor, l, `Form completed: ${l.form.name}`, { event: "completed" });
}

async function requireTask(actor: FormActor, taskId: string): Promise<{ db: Db; tc: TaskCtx; access: Access }> {
  const db = await getDb();
  const tc = await loadTask(db, actor.orgId, taskId);
  if (!tc) throw new Error("Task not found.");
  const access = accessFor(actor, tc);
  if (!access.allowedSection) throw new Error("Task not found.");
  return { db, tc, access };
}

/* ---------------------------------- autosave ---------------------------------- */

export type SaveAnswersResult = { saved: string[]; errors: FieldError[]; evaluation: TaskEvaluation; submissionStatus: SubmissionStatus };

export async function saveAnswers(actor: FormActor, taskId: string, patch: Record<string, unknown>): Promise<SaveAnswersResult> {
  assertWriter(actor);
  const { db, tc, access } = await requireTask(actor, taskId);
  if (tc.sub.archivedAt) throw new Error("This submission is archived.");
  if (!tc.section) throw new Error("This section no longer exists.");
  if (!(access.isAssignee || access.isAdmin)) throw new Error("Only an assignee or a form admin can edit this section.");
  if (tc.task.status !== "open" && tc.task.status !== "completed") throw new Error("This section is not open yet.");

  const held = await heldRoleKeys(db, actor, tc.sub.id);
  const writable = new Map<string, FieldDef>();
  for (const f of tc.section.fields) {
    if (f.type === "content" || f.readOnly || !canSeeField(f, actor, held)) continue;
    writable.set(f.key, f);
  }
  const current = tc.sub.answers ?? {};
  const errors: FieldError[] = [];
  const incoming: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch ?? {})) {
    const field = writable.get(key);
    if (!field) continue;
    const n = normalizeValue(raw);
    if (!n.ok) { errors.push({ fieldKey: key, message: "That value cannot be saved" }); continue; }
    const refError = await checkReferences(db, actor.orgId, tc.sub.id, field, n.value);
    if (refError) { errors.push({ fieldKey: key, message: refError }); continue; }
    incoming[key] = n.value;
  }
  const merged = { ...current, ...incoming };
  const ev = evaluate(tc.def, merged, evalContext(tc, new Date()));
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(incoming)) {
    if (!ev.fieldVisible[key]) continue;
    const err = validateAnswer(writable.get(key)!, incoming[key], ev.answers);
    if (err) errors.push({ fieldKey: key, message: err });
    if (!sameJson(current[key], incoming[key])) changed[key] = incoming[key];
  }
  // Values set by rules are stored with the answers they came from.
  for (const [key, value] of Object.entries(ev.setValues)) if (!sameJson(current[key], value) && !(key in changed)) changed[key] = value;

  if (Object.keys(changed).length) {
    await db.update(formSubmissions).set({
      answers: sql`${formSubmissions.answers} || ${JSON.stringify(changed)}::jsonb`,
      ...(tc.sub.status === "completed" ? { editedAfterCompletion: true } : {}),
    }).where(and(eq(formSubmissions.id, tc.sub.id), eq(formSubmissions.orgId, actor.orgId)));
    for (const [key, value] of Object.entries(changed)) {
      await writeEvent(db, actor, { orgId: actor.orgId, formId: tc.form.id, submissionId: tc.sub.id, taskId: tc.task.id, kind: "answer_changed", fieldKey: key, before: current[key] ?? null, after: value, versionId: tc.version.id });
    }
    if (tc.sub.status === "completed") await logActivity(db, actor, tc, `Form edited after completion: ${tc.form.name}`, { event: "edited_after_completion", sectionKey: tc.task.sectionKey });
  }
  const finalAnswers = { ...merged, ...changed };
  const ev2 = evaluate(tc.def, finalAnswers, evalContext(tc, new Date()));
  return { saved: Object.keys(changed), errors, evaluation: restrictEvaluation(ev2, tc.section.fields.filter((f) => canSeeField(f, actor, held)).map((f) => f.key)), submissionStatus: tc.sub.status };
}

function restrictEvaluation(ev: ReturnType<typeof evaluate>, keys: string[]): TaskEvaluation {
  const out: TaskEvaluation = { fieldVisible: {}, fieldRequired: {}, setValues: {} };
  for (const k of keys) {
    out.fieldVisible[k] = ev.fieldVisible[k] ?? true;
    out.fieldRequired[k] = ev.fieldRequired[k] ?? false;
    if (k in ev.setValues) out.setValues[k] = ev.setValues[k];
  }
  return out;
}

/* ------------------------- completion, approvals, send back ------------------------- */

function ruleOf(task: TaskRow): CompletionRule {
  return { type: task.completionRule, count: task.minimumCount ?? undefined };
}

async function uniqueChecker(db: Db, tc: TaskCtx): Promise<(fieldKey: string, value: unknown) => boolean> {
  const keys = (tc.section?.fields ?? []).filter((f) => f.unique).map((f) => f.key);
  if (!keys.length) return () => true;
  const others = await db.select({ answers: formSubmissions.answers }).from(formSubmissions)
    .where(and(eq(formSubmissions.orgId, tc.sub.orgId), eq(formSubmissions.formId, tc.form.id), isNull(formSubmissions.archivedAt), sql`${formSubmissions.id} <> ${tc.sub.id}`));
  const used = new Map<string, Set<string>>(keys.map((k) => [k, new Set<string>()]));
  for (const o of others) for (const k of keys) { const v = o.answers?.[k]; if (!isEmptyValue(v)) used.get(k)!.add(normalizeText(Array.isArray(v) ? v.join("|") : v)); }
  return (k, v) => !used.get(k)?.has(normalizeText(Array.isArray(v) ? v.join("|") : v));
}

export type CompleteResult = { ok: true; taskCompleted: boolean; submissionStatus: SubmissionStatus } | { ok: false; errors: FieldError[] };

async function validateForCompletion(db: Db, actor: FormActor, tc: TaskCtx): Promise<FieldError[]> {
  const result = validateSection(tc.def, tc.task.sectionKey, tc.sub.answers ?? {}, evalContext(tc, new Date()), { isUnique: await uniqueChecker(db, tc) });
  if (result.ok) return [];
  const held = await heldRoleKeys(db, actor, tc.sub.id);
  const visible = new Set((tc.section?.fields ?? []).filter((f) => canSeeField(f, actor, held)).map((f) => f.key));
  return result.errors.filter((e) => e.fieldKey === "" || visible.has(e.fieldKey));
}

async function currentSubmissionStatus(db: Db, orgId: string, submissionId: string): Promise<SubmissionStatus> {
  const s = await db.query.formSubmissions.findFirst({ where: and(eq(formSubmissions.id, submissionId), eq(formSubmissions.orgId, orgId)) });
  return (s?.status ?? "in_progress") as SubmissionStatus;
}

/** Marks the actor's part done, and finishes the task when its completion rule is met. */
async function finishTask(actor: FormActor, taskId: string, mode: "complete" | "approve", comment?: string): Promise<CompleteResult> {
  assertWriter(actor);
  const { db, tc, access } = await requireTask(actor, taskId);
  if (tc.sub.archivedAt) throw new Error("This submission is archived.");
  if (tc.task.status !== "open") throw new Error("This section is not open.");
  if (!tc.section) throw new Error("This section no longer exists.");
  if (mode === "complete" && tc.section.needsApproval) throw new Error("This step needs an approval decision.");
  if (mode === "approve" && !tc.section.needsApproval) throw new Error("This step is not an approval.");
  if (mode === "approve" && actor.kind === "external") throw new Error("Approvals are made by the team.");
  if (!access.myAssignee) throw new Error("Only an assignee can complete this step.");
  if (access.myAssignee.completedAt) throw new Error("You already completed this step.");
  const errors = await validateForCompletion(db, actor, tc);
  if (errors.length) return { ok: false, errors };

  const now = new Date();
  await db.update(formTaskAssignees).set({ completedAt: now }).where(eq(formTaskAssignees.id, access.myAssignee.id));
  if (comment?.trim()) await insertComment(db, actor, tc, comment.trim(), [], []);
  const done = tc.assignees.filter((a) => a.completedAt || a.id === access.myAssignee!.id).length;
  const complete = isTaskComplete(ruleOf(tc.task), tc.assignees.length, done);
  await writeEvent(db, actor, { orgId: actor.orgId, formId: tc.form.id, submissionId: tc.sub.id, taskId: tc.task.id, kind: mode === "approve" ? "approved" : "section_completed", after: { sectionKey: tc.task.sectionKey, taskCompleted: complete } });
  if (complete) await closeTask(db, actor, tc, mode === "approve" ? "approved" : null, now);
  return { ok: true, taskCompleted: complete, submissionStatus: await currentSubmissionStatus(db, actor.orgId, tc.sub.id) };
}

async function closeTask(db: Db, actor: FormActor | null, tc: TaskCtx, outcome: "approved" | null, now: Date): Promise<void> {
  await db.update(formTasks).set({ status: "completed", completedAt: now, approvalOutcome: outcome, returnToSectionKey: null }).where(eq(formTasks.id, tc.task.id));
  await logActivity(db, actor, tc, `${outcome === "approved" ? "Approved" : "Completed"}: ${tc.form.name}, ${tc.section?.title ?? tc.task.sectionKey}`, { event: outcome ? "approved" : "section_completed", sectionKey: tc.task.sectionKey });
  const toNotify: string[] = [];
  if (tc.task.returnToSectionKey) {
    // A section that was sent back returns to the approver instead of starting the next section.
    const approval = await db.query.formTasks.findFirst({ where: and(eq(formTasks.submissionId, tc.sub.id), eq(formTasks.orgId, tc.sub.orgId), eq(formTasks.sectionKey, tc.task.returnToSectionKey)) });
    if (approval) {
      await db.update(formTasks).set({ status: "open", openedAt: now, completedAt: null, approvalOutcome: null, sentBackToSectionKey: null }).where(eq(formTasks.id, approval.id));
      await db.update(formTaskAssignees).set({ completedAt: null }).where(and(eq(formTaskAssignees.taskId, approval.id), isNull(formTaskAssignees.removedAt)));
      toNotify.push(approval.id);
    }
  }
  toNotify.push(...(await advance(db, actor, tc.sub.orgId, tc.sub.id)));
  await notifyOpened(tc.sub.orgId, toNotify);
}

export async function completeTask(actor: FormActor, taskId: string): Promise<CompleteResult> {
  return finishTask(actor, taskId, "complete");
}

export async function approveTask(actor: ProfileActor, taskId: string, comment?: string): Promise<CompleteResult> {
  return finishTask(actor, taskId, "approve", comment);
}

/**
 * Reject ends the form. The approval task completes with outcome rejected, every other unfinished task is marked skipped,
 * and the submission status becomes completed. The rejection is recorded in form_events and on the task.
 */
export async function rejectTask(actor: ProfileActor, taskId: string, comment?: string): Promise<void> {
  assertWriter(actor);
  const { db, tc, access } = await requireTask(actor, taskId);
  if (tc.sub.archivedAt) throw new Error("This submission is archived.");
  if (tc.task.status !== "open" || !tc.section?.needsApproval) throw new Error("This step is not waiting for a decision.");
  if (!(access.isAssignee || access.isAdmin)) throw new Error("Only an assignee or a form admin can reject.");
  const now = new Date();
  if (comment?.trim()) await insertComment(db, actor, tc, comment.trim(), [], []);
  await db.update(formTasks).set({ status: "completed", completedAt: now, approvalOutcome: "rejected" }).where(eq(formTasks.id, tc.task.id));
  const others = await db.select().from(formTasks).where(and(eq(formTasks.submissionId, tc.sub.id), isNull(formTasks.archivedAt)));
  for (const t of others) if (t.id !== tc.task.id && (t.status === "open" || t.status === "not_started")) await db.update(formTasks).set({ status: "skipped" }).where(eq(formTasks.id, t.id));
  await db.update(formSubmissions).set({ status: "completed", completedAt: now, dueAt: null }).where(eq(formSubmissions.id, tc.sub.id));
  await writeEvent(db, actor, { orgId: actor.orgId, formId: tc.form.id, submissionId: tc.sub.id, taskId: tc.task.id, kind: "rejected", after: { sectionKey: tc.task.sectionKey, comment: comment?.trim() ?? null } });
  await logActivity(db, actor, tc, `Rejected: ${tc.form.name}, ${tc.section.title}`, { event: "rejected", sectionKey: tc.task.sectionKey });
}

export async function sendBackTask(actor: ProfileActor, taskId: string, toSectionKey: string, comment: string): Promise<void> {
  assertWriter(actor);
  const text = comment.trim();
  if (!text) throw new Error("Add a comment that says what to fix.");
  const { db, tc, access } = await requireTask(actor, taskId);
  if (tc.sub.archivedAt) throw new Error("This submission is archived.");
  if (tc.task.status !== "open" || !tc.section?.needsApproval) throw new Error("This step is not waiting for a decision.");
  if (!(access.isAssignee || access.isAdmin)) throw new Error("Only an assignee or a form admin can send this back.");
  const order = orderedSections(tc.def).map((s) => s.key);
  if (order.indexOf(toSectionKey) < 0 || order.indexOf(toSectionKey) >= order.indexOf(tc.task.sectionKey)) throw new Error("Choose an earlier section to send this back to.");
  const target = await db.query.formTasks.findFirst({ where: and(eq(formTasks.submissionId, tc.sub.id), eq(formTasks.orgId, actor.orgId), eq(formTasks.sectionKey, toSectionKey), isNull(formTasks.archivedAt)) });
  if (!target || target.status !== "completed") throw new Error("That section has not been completed, so it cannot be reopened.");
  const now = new Date();
  await db.update(formTasks).set({ status: "open", openedAt: now, completedAt: null, approvalOutcome: null, returnToSectionKey: tc.task.sectionKey }).where(eq(formTasks.id, target.id));
  await db.update(formTaskAssignees).set({ completedAt: null }).where(and(eq(formTaskAssignees.taskId, target.id), isNull(formTaskAssignees.removedAt)));
  await db.update(formTasks).set({ status: "not_started", completedAt: null, approvalOutcome: "sent_back", sentBackToSectionKey: toSectionKey }).where(eq(formTasks.id, tc.task.id));
  await db.update(formTaskAssignees).set({ completedAt: null }).where(and(eq(formTaskAssignees.taskId, tc.task.id), isNull(formTaskAssignees.removedAt)));
  await db.insert(formComments).values({ orgId: actor.orgId, submissionId: tc.sub.id, taskId: target.id, authorId: actor.profileId, body: text.slice(0, 5000) });
  await writeEvent(db, actor, { orgId: actor.orgId, formId: tc.form.id, submissionId: tc.sub.id, taskId: tc.task.id, kind: "sent_back", after: { fromSectionKey: tc.task.sectionKey, toSectionKey, comment: text } });
  await recomputeStatus(db, actor, actor.orgId, tc.sub.id);
  await logActivity(db, actor, tc, `Sent back: ${tc.form.name}, to ${tc.def.sections.find((s) => s.key === toSectionKey)?.title ?? toSectionKey}`, { event: "sent_back", sectionKey: toSectionKey });
  await safely("notifySentBack", () => notifySentBack(actor.orgId, target.id));
}

/* -------------------------- reassign, snooze, archive -------------------------- */

export async function reassignTask(actor: ProfileActor, taskId: string, profileIds: string[], mode: "replace" | "add" = "replace"): Promise<void> {
  assertWriter(actor);
  const { db, tc, access } = await requireTask(actor, taskId);
  if (tc.sub.archivedAt) throw new Error("This submission is archived.");
  if (tc.task.status !== "open") throw new Error("Only an open section can be reassigned.");
  if (!(access.isAssignee || access.isAdmin)) throw new Error("Only an assignee or a form admin can reassign this section.");
  const wanted = await validProfileIds(db, actor.orgId, profileIds);
  if (!wanted.length) throw new Error("Choose at least one team member.");
  const before = tc.assignees.filter((a) => a.profileId).map((a) => a.profileId!);
  const now = new Date();
  const added: string[] = [];
  for (const id of wanted) if (await ensureAssignee(db, actor.orgId, tc.task.id, { profileId: id })) added.push(id);
  if (mode === "replace") {
    for (const a of tc.assignees) if (a.profileId && !wanted.includes(a.profileId)) await db.update(formTaskAssignees).set({ removedAt: now }).where(eq(formTaskAssignees.id, a.id));
  }
  const fresh = await db.select().from(formTaskAssignees).where(and(eq(formTaskAssignees.taskId, tc.task.id), isNull(formTaskAssignees.removedAt)));
  await writeEvent(db, actor, { orgId: actor.orgId, formId: tc.form.id, submissionId: tc.sub.id, taskId: tc.task.id, kind: "reassigned", before: { profileIds: before }, after: { profileIds: fresh.filter((a) => a.profileId).map((a) => a.profileId), mode } });
  await logActivity(db, actor, tc, `Reassigned: ${tc.form.name}, ${tc.section?.title ?? tc.task.sectionKey}`, { event: "reassigned", sectionKey: tc.task.sectionKey });
  // Removing someone can satisfy the completion rule for the people who remain.
  const completedCount = fresh.filter((a) => a.completedAt).length;
  if (completedCount > 0 && isTaskComplete(ruleOf(tc.task), fresh.length, completedCount)) {
    await closeTask(db, actor, { ...tc, assignees: fresh }, tc.section?.needsApproval ? "approved" : null, now);
  } else if (added.length) await safely("notifyTaskOpened", () => notifyTaskOpened(actor.orgId, tc.task.id));
}

export async function snoozeTask(actor: ProfileActor, taskId: string, until: Date | null): Promise<void> {
  assertWriter(actor);
  const { db, tc, access } = await requireTask(actor, taskId);
  if (tc.task.status !== "open") throw new Error("Only an open section can be snoozed.");
  if (!(access.isAssignee || access.isAdmin)) throw new Error("Only an assignee or a form admin can snooze this section.");
  if (until) {
    const now = Date.now();
    if (Number.isNaN(until.getTime()) || until.getTime() <= now) throw new Error("Choose a snooze date in the future.");
    if (until.getTime() > now + 366 * 86_400_000) throw new Error("Choose a snooze date within a year.");
  }
  await db.update(formTasks).set({ snoozedUntil: until }).where(eq(formTasks.id, tc.task.id));
  await writeEvent(db, actor, { orgId: actor.orgId, formId: tc.form.id, submissionId: tc.sub.id, taskId: tc.task.id, kind: "snoozed", before: isoOrNull(tc.task.snoozedUntil), after: isoOrNull(until) });
}

export async function archiveSubmission(actor: ProfileActor, submissionId: string): Promise<void> {
  assertWriter(actor);
  const db = await getDb();
  const l = await loadSubmission(db, actor.orgId, submissionId);
  if (!l) throw new Error("Submission not found.");
  if (!actor.isFormAdmin && l.sub.startedBy !== actor.profileId) throw new Error("Only a form admin or the person who started this form can archive it.");
  await db.update(formSubmissions).set({ status: "archived", archivedAt: new Date() }).where(eq(formSubmissions.id, l.sub.id));
  await writeEvent(db, actor, { orgId: actor.orgId, formId: l.form.id, submissionId: l.sub.id, kind: "archived", before: l.sub.status });
  await logActivity(db, actor, l, `Form archived: ${l.form.name}`, { event: "archived" });
}

export async function restoreSubmission(actor: ProfileActor, submissionId: string): Promise<void> {
  assertWriter(actor);
  const db = await getDb();
  const l = await loadSubmission(db, actor.orgId, submissionId);
  if (!l) throw new Error("Submission not found.");
  if (!actor.isFormAdmin && l.sub.startedBy !== actor.profileId) throw new Error("Only a form admin or the person who started this form can restore it.");
  await db.update(formSubmissions).set({ status: "in_progress", archivedAt: null }).where(eq(formSubmissions.id, l.sub.id));
  await writeEvent(db, actor, { orgId: actor.orgId, formId: l.form.id, submissionId: l.sub.id, kind: "restored" });
  const opened = await advance(db, actor, actor.orgId, l.sub.id);
  await notifyOpened(actor.orgId, opened);
  await logActivity(db, actor, l, `Form restored: ${l.form.name}`, { event: "restored" });
}

/* ----------------------------------- comments ----------------------------------- */

const MENTION_RE = /@\[[^\]]*\]\(profile:([0-9a-f-]{36})\)/gi;

async function insertComment(db: Db, actor: FormActor, tc: TaskCtx, body: string, documentIds: string[], mentionIds: string[]): Promise<string> {
  const [row] = await db.insert(formComments).values({
    orgId: actor.orgId, submissionId: tc.sub.id, taskId: tc.task.id,
    authorId: actor.kind === "profile" ? actor.profileId : null, authorExternalPartyId: actor.kind === "external" ? actor.partyId : null,
    body: body.slice(0, 5000), documentIds, mentionIds,
  }).returning();
  await writeEvent(db, actor, { orgId: actor.orgId, formId: tc.form.id, submissionId: tc.sub.id, taskId: tc.task.id, kind: "commented", after: { commentId: row!.id, files: documentIds.length, mentions: mentionIds.length } });
  return row!.id;
}

/** Mentions use the form @[Name](profile:<id>) in the body, or are passed in mentionIds. */
export async function addComment(actor: FormActor, input: { taskId: string; body: string; files?: File[]; mentionIds?: string[] }): Promise<{ commentId: string }> {
  assertWriter(actor);
  const { db, tc } = await requireTask(actor, input.taskId);
  if (!tc.settings.commentsEnabled) throw new Error("Comments are turned off for this form.");
  const body = input.body.trim();
  if (!body && !input.files?.length) throw new Error("Write a comment first.");
  if (body.length > 5000) throw new Error("Comments are limited to 5000 characters.");
  let mentionIds: string[] = [];
  if (actor.kind === "profile") {
    const parsed = [...body.matchAll(MENTION_RE)].map((m) => m[1]!);
    mentionIds = await validProfileIds(db, actor.orgId, [...parsed, ...(input.mentionIds ?? [])]);
  }
  const documentIds: string[] = [];
  for (const file of (input.files ?? []).slice(0, 10)) {
    if (!file || file.size === 0) continue;
    const stored = await storeFormFile({ orgId: actor.orgId, submissionId: tc.sub.id, file, uploadedBy: actor.kind === "profile" ? actor.profileId : null, externalPartyId: actor.kind === "external" ? actor.partyId : null });
    documentIds.push(stored.documentId);
  }
  const commentId = await insertComment(db, actor, tc, body || "Attached files.", documentIds, mentionIds);
  if (mentionIds.length) await safely("notifyMentions", () => notifyMentions(actor.orgId, commentId));
  return { commentId };
}

/* --------------------------------- task window --------------------------------- */

export async function loadTaskWindow(actor: FormActor, taskId: string): Promise<TaskWindowData | null> {
  const db = await getDb();
  const tc = await loadTask(db, actor.orgId, taskId);
  if (!tc || !tc.section) return null;
  const access = accessFor(actor, tc);
  if (!access.allowedSection) return null;
  const held = await heldRoleKeys(db, actor, tc.sub.id);
  const now = new Date();
  const ev = evaluate(tc.def, tc.sub.answers ?? {}, evalContext(tc, now));
  const sections = orderedSections(tc.def);
  const myIndex = sections.findIndex((s) => s.key === tc.task.sectionKey);

  const sectionFields = sortByOrder(tc.section.fields).filter((f) => canSeeField(f, actor, held));
  const earlier = sections.slice(0, Math.max(myIndex, 0))
    .filter((s) => ev.sectionVisible[s.key] !== false)
    .map((s) => ({ key: s.key, title: s.title, fields: sortByOrder(s.fields).filter((f) => f.type !== "content" && ev.fieldVisible[f.key] && canSeeField(f, actor, held)) }))
    .filter((s) => s.fields.length > 0);

  const answers: Record<string, unknown> = {};
  const answered = ev.answers;
  for (const f of [...sectionFields, ...earlier.flatMap((s) => s.fields)]) if (f.type !== "content" && f.key in answered) answers[f.key] = answered[f.key];
  const visibleKeys = new Set([...sectionFields.map((f) => f.key), ...earlier.flatMap((s) => s.fields.map((f) => f.key))]);

  // People
  const profileIds = tc.assignees.map((a) => a.profileId).filter((x): x is string => !!x);
  const partyIds = tc.assignees.map((a) => a.externalPartyId).filter((x): x is string => !!x);
  const comments = await db.select().from(formComments).where(and(eq(formComments.taskId, tc.task.id), eq(formComments.orgId, actor.orgId), isNull(formComments.archivedAt))).orderBy(asc(formComments.createdAt));
  const events = await db.select().from(formEvents).where(and(eq(formEvents.taskId, tc.task.id), eq(formEvents.orgId, actor.orgId))).orderBy(desc(formEvents.at)).limit(100);
  const wantProfiles = new Set<string>([...profileIds, ...comments.map((c) => c.authorId).filter((x): x is string => !!x), ...comments.flatMap((c) => c.mentionIds), ...events.map((e) => e.actorId).filter((x): x is string => !!x)]);
  const wantParties = new Set<string>([...partyIds, ...comments.map((c) => c.authorExternalPartyId).filter((x): x is string => !!x)]);
  const profileRows = wantProfiles.size ? await db.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(and(eq(profiles.orgId, actor.orgId), inArray(profiles.id, [...wantProfiles]))) : [];
  const partyRows = wantParties.size ? await db.select({ id: formExternalParties.id, name: formExternalParties.name, email: formExternalParties.email, phone: formExternalParties.phone }).from(formExternalParties).where(and(eq(formExternalParties.orgId, actor.orgId), inArray(formExternalParties.id, [...wantParties]))) : [];
  const profileName = new Map(profileRows.map((p) => [p.id, p.name]));
  const partyName = new Map(partyRows.map((p) => [p.id, actor.kind === "profile" ? (p.name ?? p.email ?? p.phone ?? "External party") : (p.name ?? "External party")]));

  const assignees: TaskAssigneeView[] = tc.assignees.map((a) => ({
    id: a.id, kind: a.profileId ? "profile" : "external", name: a.profileId ? (profileName.get(a.profileId) ?? "Team member") : (partyName.get(a.externalPartyId!) ?? "External party"),
    profileId: a.profileId, externalPartyId: actor.kind === "profile" ? a.externalPartyId : null, completedAt: isoOrNull(a.completedAt),
  }));

  const docIds = [...new Set(comments.flatMap((c) => c.documentIds))];
  const docRows = docIds.length ? await db.select({ id: documents.id, filename: documents.filename }).from(documents).where(and(eq(documents.orgId, actor.orgId), inArray(documents.id, docIds))) : [];
  const docName = new Map(docRows.map((d) => [d.id, d.filename]));
  const commentViews: TaskCommentView[] = comments.map((c) => ({
    id: c.id, body: c.body, createdAt: c.createdAt.toISOString(),
    authorKind: c.authorId ? "profile" : c.authorExternalPartyId ? "external" : "unknown",
    authorName: c.authorId ? (profileName.get(c.authorId) ?? "Team member") : c.authorExternalPartyId ? (partyName.get(c.authorExternalPartyId) ?? "External party") : "Unknown",
    files: c.documentIds.filter((d) => docName.has(d)).map((d) => ({ documentId: d, filename: docName.get(d)! })),
    mentionNames: c.mentionIds.map((m) => profileName.get(m)).filter((n): n is string => !!n),
  }));

  const externalKinds = new Set(["section_opened", "section_completed", "commented"]);
  const history: TaskHistoryView[] = events
    .filter((e) => {
      if (actor.kind === "external") return externalKinds.has(e.kind);
      if (e.kind === "answer_changed") return !!e.fieldKey && visibleKeys.has(e.fieldKey);
      return true;
    })
    .map((e) => ({
      id: e.id, kind: e.kind, at: e.at.toISOString(),
      actorName: e.actorId ? (profileName.get(e.actorId) ?? "Team member") : (e.actorLabel ?? "System"),
      fieldKey: e.fieldKey, before: actor.kind === "external" ? null : e.before, after: actor.kind === "external" ? null : e.after,
    }));

  const open = tc.task.status === "open";
  const live = !tc.sub.archivedAt;
  const writer = !(actor.kind === "profile" && actor.role === "viewer");
  const mine = access.myAssignee;
  const isProfile = actor.kind === "profile";
  const permissions = {
    canEdit: writer && live && (open || tc.task.status === "completed") && (access.isAssignee || access.isAdmin),
    canComplete: writer && live && open && !tc.section.needsApproval && !!mine && !mine.completedAt,
    canApprove: writer && live && open && tc.section.needsApproval && isProfile && !!mine && !mine.completedAt,
    canReassign: writer && live && open && isProfile && (access.isAssignee || access.isAdmin),
    canSnooze: writer && live && open && isProfile && (access.isAssignee || access.isAdmin),
    canComment: writer && live && tc.settings.commentsEnabled,
    canInvite: writer && live && open && isProfile && tc.section.allowExternal && (access.isAssignee || access.isAdmin),
  };

  const subjectLabel = await subjectLabelFor(db, actor.orgId, tc.sub.leadId, tc.sub.buyerId);
  const starter = tc.sub.startedBy ? await db.query.profiles.findFirst({ where: and(eq(profiles.id, tc.sub.startedBy), eq(profiles.orgId, actor.orgId)) }) : undefined;
  const statusByKey = new Map((await db.select({ k: formTasks.sectionKey, s: formTasks.status }).from(formTasks).where(and(eq(formTasks.submissionId, tc.sub.id), isNull(formTasks.archivedAt)))).map((r) => [r.k, r.s]));
  const sendBackTargets = open && tc.section.needsApproval && isProfile
    ? sections.slice(0, Math.max(myIndex, 0)).filter((s) => statusByKey.get(s.key) === "completed").map((s) => ({ key: s.key, title: s.title }))
    : [];

  return {
    task: {
      id: tc.task.id, submissionId: tc.sub.id, sectionKey: tc.task.sectionKey, roleKey: tc.task.roleKey, status: tc.task.status, completionRule: ruleOf(tc.task),
      dueAt: isoOrNull(tc.task.dueAt), snoozedUntil: isoOrNull(tc.task.snoozedUntil), openedAt: isoOrNull(tc.task.openedAt), completedAt: isoOrNull(tc.task.completedAt),
      approvalOutcome: tc.task.approvalOutcome, returnToSectionKey: tc.task.returnToSectionKey,
    },
    form: { id: tc.form.id, name: tc.form.name, versionNumber: tc.version.number, commentsEnabled: tc.settings.commentsEnabled, timeZone: tc.settings.timeZone },
    submission: {
      id: tc.sub.id, title: tc.sub.title, status: tc.sub.status, subjectType: tc.sub.subjectType, leadId: actor.kind === "profile" ? tc.sub.leadId : null, buyerId: actor.kind === "profile" ? tc.sub.buyerId : null,
      subjectLabel, startedByName: starter?.fullName ?? null, createdAt: tc.sub.createdAt.toISOString(), dueAt: isoOrNull(tc.sub.dueAt), editedAfterCompletion: tc.sub.editedAfterCompletion,
    },
    section: { key: tc.section.key, title: tc.section.title, description: tc.section.description ?? null, needsApproval: tc.section.needsApproval, allowExternal: tc.section.allowExternal, fields: sectionFields },
    answers, earlierSections: earlier,
    evaluation: restrictEvaluation(ev, [...visibleKeys]),
    assignees, comments: commentViews, history, permissions, sendBackTargets,
  };
}
