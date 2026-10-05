"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { leads, properties, contacts, propertyContacts, pipelineStages, activities, tasks, leadTags, tags, offers, campaignEnrollments, campaigns, profiles, dealAnalyses, leadSources } from "@dealcalc/db";
import { judgmentProvider, assessDistress, normalizePhone } from "@dealcalc/integrations";
import { getDb } from "../db";
import { requireSession, requireCan, can } from "../auth";
import { audit } from "../audit";
import { sendToLead, ConsentError } from "../services/messaging";
import { enrichProperty } from "../services/enrichment";
import { autoEnrichNewLead, checkEnrichmentBudget, estimatedReportCostCents } from "../services/enrichment-budget";
import { emitEvent } from "../services/integrations";
import { rescoreLead } from "../services/lead-scoring";
import { markOfferAccepted } from "../services/alerts";
import { toNumber, toOptionalNumber } from "../utils";
import { friendlyError, isUuid, moneyField, numberField, textField, dateOnlyField, MAX_MONEY } from "../safe";
import { leadQuickView, type LeadQuickView } from "../data/leads";

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };

/** Notes, calls, and tasks are open to every role except viewer, matching the row level security policies. */
function requireContributor(session: { role: string }): void {
  if (session.role === "viewer") throw new Error("Your role (viewer) is read only.");
}

/**
 * A datetime-local field posts "2026-09-21T14:30" with no zone. Forms send the browser's tzOffset in minutes
 * so the time means what the user saw; without it the value is read in the server's zone.
 */
function parseLocalDateTime(value: string, tzOffsetMinutes?: string | null): Date | null {
  if (!value) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) { const zoned = new Date(value); return Number.isNaN(zoned.getTime()) ? null : zoned; }
  const offset = tzOffsetMinutes != null && tzOffsetMinutes !== "" && Number.isFinite(Number(tzOffsetMinutes)) ? Number(tzOffsetMinutes) : null;
  const d = new Date(offset === null ? value : `${value.length === 16 ? value + ":00" : value}Z`);
  if (Number.isNaN(d.getTime())) return null;
  return offset === null ? d : new Date(d.getTime() + offset * 60_000);
}

const LEAD_FIELD_LABELS: Record<string, string> = {
  addressLine1: "street address", addressLine2: "unit", city: "city", state: "state", postalCode: "ZIP", propertyType: "property type", beds: "beds", baths: "baths", sqft: "square feet", yearBuilt: "year built",
  firstName: "first name", lastName: "last name", phone: "phone", email: "email", askingPrice: "asking price", notes: "notes", sourceId: "source", assignedTo: "assigned to",
};

/** Suggestions only. Shown at 0.5 and up so the keyword mock (capped at 0.55) still surfaces something to review. */
const SUGGEST_AT = 0.5;
async function suggestIssuesFromText(orgId: string, leadId: string, text: string): Promise<void> {
  if (text.length <= 20) return;
  try {
    const db = await getDb();
    const assessment = await assessDistress(judgmentProvider(), text);
    const strong = Object.entries(assessment.signals).filter(([, p]) => p >= SUGGEST_AT).map(([k, p]) => `${k.replace(/_/g, " ")} (${Math.round(p * 100)}%)`);
    if (strong.length) await db.insert(activities).values({ orgId, leadId, actorId: null, type: "system", payload: { text: `Suggested deal issues from notes (${assessment.provider}, review before flagging): ${strong.join(", ")}`, suggestions: assessment.signals, motivationScore: assessment.motivationScore } });
  } catch { /* judgment is optional */ }
}

/**
 * The lead's next follow up is the earliest open task on it. Called after a task is added, completed, or reopened,
 * so an overdue task is never hidden by a later one and the due lists match the task list.
 */
async function syncNextFollowUp(orgId: string, leadId: string): Promise<void> {
  const db = await getDb();
  const [next] = await db.select({ dueAt: tasks.dueAt }).from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.leadId, leadId), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1);
  await db.update(leads).set({ nextFollowUpAt: next?.dueAt ?? null }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
}

const NewLeadSchema = z.object({
  addressLine1: z.string().min(3, "Enter the street address").max(200), addressLine2: z.string().max(60).optional(), city: z.string().min(1).max(80), state: z.string().regex(/^[A-Z]{2}$/, "State must be a two letter code such as MD"), postalCode: z.string().regex(/^\d{5}(-\d{4})?$/, "ZIP must be 5 digits"),
  propertyType: z.string().max(60).optional(), beds: z.number().min(0).max(50).nullable(), baths: z.number().min(0).max(50).nullable(), sqft: z.number().int().min(0).max(1_000_000).nullable(), yearBuilt: z.number().int().min(1600).max(2100).nullable(),
  occupancy: z.enum(["owner", "tenant", "vacant", "unknown"]), condition: z.enum(["1", "2", "3", "4", "5", "unknown"]),
  firstName: z.string().min(1, "Enter the contact first name").max(80), lastName: z.string().max(80).optional(), phone: z.string().max(40).optional(), email: z.string().email("Enter a valid email address").max(254).optional().or(z.literal("")),
  relationship: z.enum(["owner", "heir", "agent", "attorney", "tenant", "other"]), smsConsent: z.enum(["unknown", "opted_in", "opted_out"]),
  sourceId: z.string().uuid().optional().or(z.literal("")), assignedTo: z.string().uuid().optional().or(z.literal("")), askingPrice: z.number().min(0, "Asking price must be zero or more").max(MAX_MONEY).nullable(),
  sellerUrgency: z.enum(["none", "low", "medium", "high", "immediate"]), notes: z.string().max(8000).optional(), enrich: z.boolean(),
});

export async function createLead(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    const parsed = NewLeadSchema.safeParse({
      addressLine1: form.get("addressLine1"), addressLine2: form.get("addressLine2") || undefined, city: form.get("city"), state: String(form.get("state") ?? "").toUpperCase(), postalCode: form.get("postalCode"),
      propertyType: form.get("propertyType") || undefined, beds: toOptionalNumber(form.get("beds")), baths: toOptionalNumber(form.get("baths")), sqft: toOptionalNumber(form.get("sqft")), yearBuilt: toOptionalNumber(form.get("yearBuilt")),
      occupancy: form.get("occupancy") ?? "unknown", condition: form.get("condition") ?? "unknown",
      firstName: form.get("firstName"), lastName: form.get("lastName") || undefined, phone: form.get("phone") || undefined, email: form.get("email") || "",
      relationship: form.get("relationship") ?? "owner", smsConsent: form.get("smsConsent") ?? "unknown",
      sourceId: form.get("sourceId") ?? "", assignedTo: form.get("assignedTo") ?? "", askingPrice: toOptionalNumber(form.get("askingPrice")),
      sellerUrgency: form.get("sellerUrgency") ?? "none", notes: form.get("notes") || undefined, enrich: form.get("enrich") === "on",
    });
    if (!parsed.success) return { ok: false, error: Array.from(new Set(parsed.error.issues.map((i) => (/^(String|Number|Expected|Invalid|Required)/.test(i.message) ? `Check the ${LEAD_FIELD_LABELS[String(i.path[0])] ?? String(i.path[0])} field.` : i.message)))).join(" ") };
    const d = parsed.data;
    // Store phones in one format so the Call link, texting, and inbound matching all agree.
    let phone: string | null = null;
    if (d.phone && d.phone.trim()) {
      phone = normalizePhone(d.phone.trim());
      if (!phone) return { ok: false, error: "Enter a 10 digit US phone number, or leave the phone blank." };
    }
    const db = await getDb();
    if (d.sourceId && !(await db.query.leadSources.findFirst({ where: and(eq(leadSources.id, d.sourceId), eq(leadSources.orgId, session.orgId)) }))) return { ok: false, error: "That lead source was not found." };
    if (d.assignedTo && !(await db.query.profiles.findFirst({ where: and(eq(profiles.id, d.assignedTo), eq(profiles.orgId, session.orgId), eq(profiles.active, true)) }))) return { ok: false, error: "That team member was not found." };
    const stage = await db.query.pipelineStages.findFirst({ where: and(eq(pipelineStages.orgId, session.orgId), eq(pipelineStages.key, "new_lead")) })
      ?? (await db.select().from(pipelineStages).where(eq(pipelineStages.orgId, session.orgId)).orderBy(pipelineStages.position).limit(1))[0];
    if (!stage) return { ok: false, error: "No pipeline stages configured. Add stages under Settings." };

    const [property] = await db.insert(properties).values({
      orgId: session.orgId, addressLine1: d.addressLine1, addressLine2: d.addressLine2 ?? null, city: d.city, state: d.state, postalCode: d.postalCode,
      propertyType: d.propertyType ?? null, beds: d.beds != null ? String(d.beds) : null, baths: d.baths != null ? String(d.baths) : null, sqft: d.sqft, yearBuilt: d.yearBuilt,
      occupancy: d.occupancy, condition: d.condition, notes: d.notes ?? null,
    }).returning();
    const [contact] = await db.insert(contacts).values({
      orgId: session.orgId, firstName: d.firstName, lastName: d.lastName ?? null, relationship: d.relationship, smsConsent: d.smsConsent, smsConsentAt: d.smsConsent === "unknown" ? null : new Date(),
      phones: phone ? [{ number: phone, type: "mobile", isPrimary: true }] : [], emails: d.email ? [{ address: d.email.toLowerCase(), isPrimary: true }] : [],
    }).returning();
    await db.insert(propertyContacts).values({ orgId: session.orgId, propertyId: property!.id, contactId: contact!.id, role: d.relationship, isPrimary: true });
    const [lead] = await db.insert(leads).values({
      orgId: session.orgId, propertyId: property!.id, primaryContactId: contact!.id, stageId: stage.id, sourceId: d.sourceId || null, assignedTo: d.assignedTo || session.profileId,
      askingPrice: d.askingPrice != null ? String(d.askingPrice) : null, sellerUrgency: d.sellerUrgency, nextFollowUpAt: new Date(),
    }).returning();
    await db.insert(activities).values({ orgId: session.orgId, leadId: lead!.id, actorId: session.profileId, type: "system", payload: { text: "Lead created" } });
    if (d.notes) { await db.insert(activities).values({ orgId: session.orgId, leadId: lead!.id, actorId: session.profileId, type: "note", payload: { text: d.notes } }); await suggestIssuesFromText(session.orgId, lead!.id, d.notes); await rescoreLead(session.orgId, lead!.id); }
    await db.insert(tasks).values({ orgId: session.orgId, leadId: lead!.id, assignedTo: d.assignedTo || session.profileId, title: "First call", kind: "call", dueAt: new Date() });
    await audit(session, { entityType: "lead", entityId: lead!.id, action: "create", after: { propertyId: property!.id, contactId: contact!.id } });
    await emitEvent(session.orgId, "lead.created", { leadId: lead!.id, propertyId: property!.id, via: "app", externalId: null, address: { line1: d.addressLine1, line2: d.addressLine2 ?? null, city: d.city, state: d.state, postalCode: d.postalCode }, contact: { id: contact!.id, firstName: d.firstName, lastName: d.lastName ?? null, phone: d.phone ?? null, email: d.email || null }, askingPrice: d.askingPrice, urgency: d.sellerUrgency, source: null, sourceId: d.sourceId || null, stage: { key: stage.key, name: stage.name } });
    if (d.enrich) {
      try { await enrichProperty(session.orgId, property!.id, session.profileId); } catch { /* report page shows the failure */ }
    } else await autoEnrichNewLead(session.orgId, property!.id, session.profileId);
    revalidatePath("/leads"); revalidatePath("/pipeline"); revalidatePath("/dashboard");
    return { ok: true, id: lead!.id };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not create the lead.") };
  }
}

export async function moveLeadStage(leadId: string, stageId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    const db = await getDb();
    const [lead, stage] = await Promise.all([
      db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) }),
      db.query.pipelineStages.findFirst({ where: and(eq(pipelineStages.id, stageId), eq(pipelineStages.orgId, session.orgId)) }),
    ]);
    if (!lead || !stage) return { ok: false, error: "Lead or stage not found." };
    if (lead.stageId === stage.id) return { ok: true };
    const from = await db.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, lead.stageId) });
    const status = stage.key === "closed" ? "won" : stage.key === "dead_nurture" ? "nurture" : "open";
    await db.update(leads).set({ stageId: stage.id, stageEnteredAt: new Date(), status }).where(eq(leads.id, leadId));
    await db.insert(activities).values({ orgId: session.orgId, leadId, actorId: session.profileId, type: "stage_change", payload: { from: from?.key, to: stage.key, fromName: from?.name, toName: stage.name } });
    await audit(session, { entityType: "lead", entityId: leadId, action: "stage_change", before: { stage: from?.key }, after: { stage: stage.key } });
    await emitEvent(session.orgId, "lead.stage_changed", { leadId, propertyId: lead.propertyId, status, from: from ? { key: from.key, name: from.name } : null, to: { key: stage.key, name: stage.name } });
    revalidatePath("/pipeline"); revalidatePath("/leads"); revalidatePath(`/leads/${leadId}`); revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not move the lead.") };
  }
}

export async function updateLeadFields(leadId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    const db = await getDb();
    const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) });
    if (!lead) return { ok: false, error: "Lead not found." };
    const patch: Partial<typeof leads.$inferInsert> = {};
    if (form.has("assignedTo")) {
      const v = String(form.get("assignedTo"));
      if (v && !(isUuid(v) && (await db.query.profiles.findFirst({ where: and(eq(profiles.id, v), eq(profiles.orgId, session.orgId), eq(profiles.active, true)) })))) return { ok: false, error: "That team member was not found." };
      patch.assignedTo = v || null;
    }
    if (form.has("nextFollowUpAt")) {
      const v = String(form.get("nextFollowUpAt"));
      const parsedDate = v ? parseLocalDateTime(v, form.get("tzOffset") as string | null) : null;
      if (v && !parsedDate) return { ok: false, error: "That follow up date could not be read." };
      patch.nextFollowUpAt = parsedDate;
    }
    if (form.has("sellerUrgency")) {
      const v = String(form.get("sellerUrgency"));
      if (!["none", "low", "medium", "high", "immediate"].includes(v)) return { ok: false, error: "Pick a seller urgency from the list." };
      patch.sellerUrgency = v as "none";
    }
    if (form.has("motivationScore")) { const m = numberField(form.get("motivationScore"), "Motivation score", 0, 10, { integer: true }); if (!m.ok) return m; patch.motivationScore = m.value; }
    if (form.has("askingPrice")) { const a = moneyField(form.get("askingPrice"), "Asking price"); if (!a.ok) return a; patch.askingPrice = a.value != null ? String(a.value) : null; }
    if (form.has("sourceId")) {
      const v = String(form.get("sourceId"));
      if (v && !(isUuid(v) && (await db.query.leadSources.findFirst({ where: and(eq(leadSources.id, v), eq(leadSources.orgId, session.orgId)) })))) return { ok: false, error: "That lead source was not found." };
      patch.sourceId = v || null;
    }
    if (form.has("lostReason")) {
      patch.lostReason = textField(form.get("lostReason"), 500);
      // In the Dead / Nurture stage, a stated reason means lost; no reason means still being nurtured.
      const stage = await db.query.pipelineStages.findFirst({ where: and(eq(pipelineStages.id, lead.stageId), eq(pipelineStages.orgId, session.orgId)) });
      if (stage?.key === "dead_nurture") patch.status = patch.lostReason ? "lost" : "nurture";
    }
    if (form.has("dealIssues")) {
      const issues: Record<string, { flagged: boolean; note?: string }> = {};
      for (const key of String(form.get("issueKeys") ?? "").split(",").filter(Boolean)) {
        const flagged = form.get(`issue_${key}`) === "on";
        const note = String(form.get(`issue_note_${key}`) ?? "").trim().slice(0, 1000);
        if (flagged || note) issues[key] = { flagged, note: note || undefined };
      }
      const messyScore = Object.values(issues).filter((i) => i.flagged).length;
      patch.dealIssues = { ...issues, messyScore } as any;
    }
    if (Object.keys(patch).length === 0) return { ok: true, message: "Nothing to save" };
    await db.update(leads).set(patch).where(and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)));
    await audit(session, { entityType: "lead", entityId: leadId, action: "update", before: pick(lead, Object.keys(patch)), after: patch });
    void emitEvent(session.orgId, "lead.updated", { leadId, propertyId: lead.propertyId, changed: Object.keys(patch) });
    revalidatePath(`/leads/${leadId}`); revalidatePath("/leads"); revalidatePath("/pipeline"); revalidatePath("/dashboard");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not save the lead.") };
  }
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

export async function addActivity(leadId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireContributor(session);
    const db = await getDb();
    const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) });
    if (!lead) return { ok: false, error: "Lead not found." };
    const type = String(form.get("type") ?? "note") === "call" ? "call" : "note";
    const text = String(form.get("text") ?? "").trim().slice(0, 20000);
    const outcome = String(form.get("outcome") ?? "").slice(0, 60);
    if (!text && type === "note") return { ok: false, error: "Write a note first." };
    await db.insert(activities).values({ orgId: session.orgId, leadId, actorId: session.profileId, type, payload: { text, outcome } });
    if (type === "call") {
      await db.update(leads).set({ lastContactAt: new Date(), contactAttempts: sql`${leads.contactAttempts} + 1`, firstResponseMinutes: outcome === "spoke" && lead.firstResponseMinutes == null ? Math.max(1, Math.round((Date.now() - new Date(lead.createdAt).getTime()) / 60_000)) : lead.firstResponseMinutes }).where(eq(leads.id, leadId));
    }
    // Suggest deal issues from the note through the judgment provider; only stored as suggestions.
    await suggestIssuesFromText(session.orgId, leadId, text);
    await rescoreLead(session.orgId, leadId);
    const next = parseLocalDateTime(String(form.get("nextFollowUpAt") ?? ""), form.get("tzOffset") as string | null);
    if (next) await db.update(leads).set({ nextFollowUpAt: next }).where(and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)));
    revalidatePath(`/leads/${leadId}`); revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not log that.") };
  }
}

export async function addTask(leadId: string | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const db = await getDb();
    requireContributor(session);
    const title = String(form.get("title") ?? "").trim();
    if (!title) return { ok: false, error: "Task needs a title." };
    if (leadId) {
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) });
      if (!lead) return { ok: false, error: "Lead not found." };
    }
    let assignedTo = session.profileId;
    const requested = String(form.get("assignedTo") || "");
    if (requested && requested !== session.profileId) {
      const assignee = await db.query.profiles.findFirst({ where: and(eq(profiles.id, requested), eq(profiles.orgId, session.orgId), eq(profiles.active, true)) });
      if (!assignee) return { ok: false, error: "That team member was not found." };
      assignedTo = assignee.id;
    }
    const kindRaw = String(form.get("kind") || "call");
    const kind = (["call", "text", "email", "visit", "other"].includes(kindRaw) ? kindRaw : "other") as "call";
    const dueAt = parseLocalDateTime(String(form.get("dueAt") ?? ""), form.get("tzOffset") as string | null) ?? new Date();
    await db.insert(tasks).values({ orgId: session.orgId, leadId, assignedTo, title: title.slice(0, 200), kind, dueAt });
    if (leadId) await syncNextFollowUp(session.orgId, leadId);
    revalidatePath(leadId ? `/leads/${leadId}` : "/tasks"); revalidatePath("/tasks"); revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not add the task.") };
  }
}

export async function completeTask(taskId: string, done: boolean): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(taskId)) return { ok: false, error: "Task not found." };
  if (session.role === "viewer") return { ok: false, error: "Your role (viewer) is read only." };
  const db = await getDb();
  const task = await db.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.orgId, session.orgId)) });
  if (!task) return { ok: false, error: "Task not found." };
  // A second click on a task that is already in the requested state changes nothing and logs nothing.
  if (Boolean(task.doneAt) === done) return { ok: true };
  await db.update(tasks).set({ doneAt: done ? new Date() : null }).where(and(eq(tasks.id, taskId), eq(tasks.orgId, session.orgId)));
  if (task.leadId) await syncNextFollowUp(session.orgId, task.leadId);
  if (done && task.leadId) await db.insert(activities).values({ orgId: session.orgId, leadId: task.leadId, actorId: session.profileId, type: "task", payload: { text: `Completed: ${task.title}` } });
  revalidatePath("/tasks"); revalidatePath("/dashboard"); if (task.leadId) revalidatePath(`/leads/${task.leadId}`);
  return { ok: true };
}

export async function toggleTag(leadId: string, tagId: string, on: boolean): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "lead:write")) return { ok: false, error: `Your role (${session.role}) cannot change tags.` };
  const db = await getDb();
  const [lead, tag] = await Promise.all([
    db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) }),
    db.query.tags.findFirst({ where: and(eq(tags.id, tagId), eq(tags.orgId, session.orgId)) }),
  ]);
  if (!lead || !tag) return { ok: false, error: "Lead or tag not found." };
  if (on) await db.insert(leadTags).values({ orgId: session.orgId, leadId, tagId }).onConflictDoNothing();
  else await db.delete(leadTags).where(and(eq(leadTags.leadId, leadId), eq(leadTags.tagId, tagId), eq(leadTags.orgId, session.orgId)));
  revalidatePath(`/leads/${leadId}`); revalidatePath("/leads");
  return { ok: true };
}

export async function createTag(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "lead:write")) return { ok: false, error: `Your role (${session.role}) cannot create tags.` };
  const db = await getDb();
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  if (!name) return { ok: false, error: "Tag needs a name." };
  const kindRaw = String(form.get("kind") || "lead");
  const kind = (["lead", "buyer", "issue"].includes(kindRaw) ? kindRaw : "lead") as "lead";
  const colorRaw = String(form.get("color") || "#6366f1");
  const color = /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw : "#6366f1";
  const existing = await db.query.tags.findFirst({ where: and(eq(tags.orgId, session.orgId), eq(tags.name, name), eq(tags.kind, kind)) });
  if (existing) return { ok: false, error: `A ${kind} tag named "${name}" already exists.` };
  const [created] = await db.insert(tags).values({ orgId: session.orgId, name, kind, color }).onConflictDoNothing().returning();
  if (!created) return { ok: false, error: `A tag named "${name}" already exists.` };
  await audit(session, { entityType: "tag", entityId: created.id, action: "create", after: { name, kind, color } });
  revalidatePath("/settings"); revalidatePath("/leads");
  return { ok: true };
}

export async function sendMessage(leadId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "message:send");
    if (!isUuid(leadId)) return { ok: false, error: "Lead not found." };
    const channel = String(form.get("channel") ?? "sms") === "email" ? "email" : "sms";
    const body = String(form.get("body") ?? "").trim();
    if (!body) return { ok: false, error: "Message is empty." };
    if (body.length > (channel === "sms" ? 1600 : 20000)) return { ok: false, error: channel === "sms" ? "Texts are limited to 1,600 characters." : "That email is too long." };
    const contactId = String(form.get("contactId") ?? "");
    // A disabled option posts nothing, which is what happens when the only contact opted out.
    if (!isUuid(contactId)) return { ok: false, error: channel === "sms" ? "No contact on this lead can receive texts. They opted out, are marked do not contact, or have no phone number." : "No contact on this lead has an email address that can be used." };
    const templateRaw = String(form.get("templateId") ?? "");
    await sendToLead({ orgId: session.orgId, senderProfileId: session.profileId, senderName: session.fullName.split(" ")[0] ?? session.fullName, leadId, contactId, channel, body, subject: String(form.get("subject") ?? "") || undefined, templateId: isUuid(templateRaw) ? templateRaw : null, appUrl: process.env.APP_URL });
    revalidatePath(`/leads/${leadId}`); revalidatePath("/dashboard");
    return { ok: true, message: "Sent" };
  } catch (err) {
    if (err instanceof ConsentError) return { ok: false, error: err.message };
    return { ok: false, error: friendlyError(err, "Could not send the message.") };
  }
}

export async function updateConsent(contactId: string, leadId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "lead:write");
  const db = await getDb();
  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, contactId), eq(contacts.orgId, session.orgId)) });
  if (!contact) return { ok: false, error: "Contact not found." };
  const smsConsent = String(form.get("smsConsent") ?? contact.smsConsent) as any;
  const doNotContact = form.get("doNotContact") === "on";
  await db.update(contacts).set({ smsConsent, smsConsentAt: new Date(), doNotContact }).where(eq(contacts.id, contactId));
  if (smsConsent === "opted_out" || doNotContact) await db.update(campaignEnrollments).set({ status: "opted_out" }).where(eq(campaignEnrollments.contactId, contactId));
  await audit(session, { entityType: "contact", entityId: contactId, action: "consent", before: { smsConsent: contact.smsConsent, doNotContact: contact.doNotContact }, after: { smsConsent, doNotContact } });
  revalidatePath(`/leads/${leadId}`);
  return { ok: true, message: "Consent updated" };
}

export async function createOffer(leadId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    const db = await getDb();
    const amount = toNumber(form.get("amount"));
    if (amount <= 0) return { ok: false, error: "Offer amount must be positive." };
    const expiresAt = dateOnlyField(form.get("expiresAt"));
    if (!expiresAt.ok) return { ok: false, error: expiresAt.error };
    const owned = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) });
    if (!owned) return { ok: false, error: "Lead not found." };
    const statusRaw = String(form.get("status") ?? "sent");
    const status = (["draft", "sent", "countered", "accepted", "rejected", "expired"].includes(statusRaw) ? statusRaw : "sent") as "sent";
    const analysisIdRaw = String(form.get("analysisId") ?? "") || null;
    const linked = analysisIdRaw ? await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisIdRaw), eq(dealAnalyses.orgId, session.orgId), eq(dealAnalyses.propertyId, owned.propertyId)) }) : null;
    if (analysisIdRaw && !linked) return { ok: false, error: "That analysis does not belong to this lead." };
    const [offer] = await db.insert(offers).values({ orgId: session.orgId, leadId, analysisId: linked?.id ?? null, amount: String(amount), type: (String(form.get("type") || "cash")) as any, status, expiresAt: expiresAt.value, acceptedAt: String(status) === "accepted" ? new Date() : null, sentAt: status === "sent" ? new Date() : null, sentVia: String(form.get("sentVia") ?? "") || null, notes: String(form.get("notes") ?? "") || null, createdBy: session.profileId }).returning();
    await db.insert(activities).values({ orgId: session.orgId, leadId, actorId: session.profileId, type: "offer", payload: { amount, status, offerId: offer!.id } });
    if (status === "sent") {
      const stage = await db.query.pipelineStages.findFirst({ where: and(eq(pipelineStages.orgId, session.orgId), eq(pipelineStages.key, "offer_sent")) });
      const lead = owned;
      const current = lead ? await db.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, lead.stageId) }) : null;
      if (stage && current && current.position < stage.position) await moveLeadStage(leadId, stage.id);
    }
    await audit(session, { entityType: "offer", entityId: offer!.id, action: "create", after: { amount, status } });
    await emitEvent(session.orgId, "offer.created", { offerId: offer!.id, leadId, analysisId: offer!.analysisId, amount, type: offer!.type, status });
    revalidatePath(`/leads/${leadId}`); revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not record the offer." };
  }
}

export async function updateOfferStatus(offerId: string, leadId: string, status: "sent" | "accepted" | "rejected" | "countered" | "expired", counterAmount?: number): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "lead:write")) return { ok: false, error: `Your role (${session.role}) cannot change offers.` };
  const db = await getDb();
  const offer = await db.query.offers.findFirst({ where: and(eq(offers.id, offerId), eq(offers.orgId, session.orgId)) });
  if (!offer) return { ok: false, error: "Offer not found." };
  // The lead comes from the offer row, never from the caller.
  leadId = offer.leadId;
  if (!["sent", "accepted", "rejected", "countered", "expired"].includes(status)) return { ok: false, error: "Unknown offer status." };
  if (counterAmount != null && !(Number.isFinite(counterAmount) && counterAmount > 0 && counterAmount <= MAX_MONEY)) return { ok: false, error: "Counter amount must be a positive dollar amount." };
  if (status === "countered" && counterAmount == null && offer.counterAmount == null) return { ok: false, error: "Enter the amount the seller countered with." };
  await db.update(offers).set({ status, sentAt: status === "sent" ? offer.sentAt ?? new Date() : offer.sentAt, acceptedAt: status === "accepted" ? offer.acceptedAt ?? new Date() : offer.acceptedAt, counterAmount: counterAmount != null ? String(counterAmount) : offer.counterAmount }).where(and(eq(offers.id, offerId), eq(offers.orgId, session.orgId)));
  await db.insert(activities).values({ orgId: session.orgId, leadId, actorId: session.profileId, type: "offer", payload: { offerId, status, counterAmount } });
  await audit(session, { entityType: "offer", entityId: offerId, action: "status", before: { status: offer.status }, after: { status, counterAmount } });
  await emitEvent(session.orgId, "offer.status_changed", { offerId, leadId, amount: Number(offer.amount), from: offer.status, to: status, counterAmount: counterAmount ?? null });
  if (status === "accepted") {
    await markOfferAccepted(session.orgId, offerId);
    revalidatePath("/alerts");
    const stage = await db.query.pipelineStages.findFirst({ where: and(eq(pipelineStages.orgId, session.orgId), eq(pipelineStages.key, "under_contract")) });
    if (stage) await moveLeadStage(leadId, stage.id);
  }
  if (status === "sent" && offer.status === "draft") {
    // Same rule as recording an offer as sent: move forward to Offer Sent, never backward.
    const [target, lead] = await Promise.all([
      db.query.pipelineStages.findFirst({ where: and(eq(pipelineStages.orgId, session.orgId), eq(pipelineStages.key, "offer_sent")) }),
      db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) }),
    ]);
    const current = lead ? await db.query.pipelineStages.findFirst({ where: and(eq(pipelineStages.id, lead.stageId), eq(pipelineStages.orgId, session.orgId)) }) : null;
    if (target && current && current.position < target.position) await moveLeadStage(leadId, target.id);
  }
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/**
 * Manual "pull report" / "refresh report" button. Runs the same budget check as an automatic report, so a manual
 * pull cannot quietly blow through the monthly budget or the per property cap. An admin may pass override to run
 * anyway; anyone else who hits a refused budget just sees the reason.
 */
export async function runEnrichment(propertyId: string, leadId?: string, overrideBudget?: boolean): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    if (!isUuid(propertyId)) return { ok: false, error: "Property not found." };
    const check = await checkEnrichmentBudget(session.orgId, propertyId, estimatedReportCostCents());
    if (!check.allowed) {
      if (!overrideBudget) return { ok: false, error: check.reason };
      if (session.role !== "admin") return { ok: false, error: `Your role (${session.role}) cannot override the report budget. ${check.reason}` };
    }
    const { report, compCount } = await enrichProperty(session.orgId, propertyId, session.profileId);
    if (leadId) revalidatePath(`/leads/${leadId}`);
    revalidatePath(`/properties/${propertyId}/report`);
    if (report.status === "failed") return { ok: false, error: report.error ?? "Provider failed." };
    return { ok: true, message: `Report from ${report.provider}, ${compCount} comps${!check.allowed ? " (budget override)" : ""}` };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "The property report could not be fetched.") };
  }
}

export async function enrollInCampaign(leadId: string, campaignId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "campaign:write");
    if (!isUuid(leadId) || !isUuid(campaignId)) return { ok: false, error: "Lead or campaign not found." };
    const db = await getDb();
    const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) });
    const campaign = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)) });
    if (!lead?.primaryContactId || !campaign) return { ok: false, error: "Lead needs a primary contact and the campaign must exist." };
    const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, lead.primaryContactId), eq(contacts.orgId, session.orgId)) });
    if (!contact) return { ok: false, error: "The primary contact was not found." };
    // Consent is checked here as well as at send time, so an opted out contact never sits in a sequence as active.
    if (contact.doNotContact) return { ok: false, error: "This contact is marked do not contact and cannot be enrolled." };
    if (campaign.channel === "sms" && contact.smsConsent === "opted_out") return { ok: false, error: "This contact opted out of SMS and cannot be enrolled in a text campaign." };
    if (campaign.channel === "sms" && contact.phones.length === 0) return { ok: false, error: "This contact has no phone number." };
    if (campaign.channel === "email" && contact.emails.length === 0) return { ok: false, error: "This contact has no email address." };
    const existing = await db.query.campaignEnrollments.findFirst({ where: and(eq(campaignEnrollments.campaignId, campaignId), eq(campaignEnrollments.leadId, leadId), eq(campaignEnrollments.orgId, session.orgId), eq(campaignEnrollments.status, "active")) });
    if (existing) return { ok: false, error: `Already enrolled in ${campaign.name}.` };
    await db.insert(campaignEnrollments).values({ orgId: session.orgId, campaignId, leadId, contactId: lead.primaryContactId, currentStep: 0, nextSendAt: new Date(), status: "active" });
    await audit(session, { entityType: "enrollment", entityId: leadId, action: "enroll", after: { campaignId, campaign: campaign.name } });
    revalidatePath(`/leads/${leadId}`); revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, message: `Enrolled in ${campaign.name}` };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not enroll the lead.") };
  }
}

/** Stop this lead's active enrollments, from the lead page. */
export async function stopLeadEnrollments(leadId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "campaign:write");
    if (!isUuid(leadId)) return { ok: false, error: "Lead not found." };
    const db = await getDb();
    const rows = await db.update(campaignEnrollments).set({ status: "stopped", nextSendAt: null }).where(and(eq(campaignEnrollments.leadId, leadId), eq(campaignEnrollments.orgId, session.orgId), eq(campaignEnrollments.status, "active"))).returning();
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: rows.length ? `Stopped ${rows.length} ${rows.length === 1 ? "sequence" : "sequences"}` : "No active sequences" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not stop the sequence.") };
  }
}

/**
 * Admin only. Deletes the lead and its timeline. The property goes too when no other lead uses it
 * (which takes its analyses, reports, and comps), and so does the contact when nothing else links to it.
 */
export async function deleteLead(leadId: string): Promise<never | ActionResult> {
  const session = await requireSession();
  if (session.role !== "admin") return { ok: false, error: "Only admins delete leads." };
  if (!isUuid(leadId)) return { ok: false, error: "Lead not found." };
  const db = await getDb();
  const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) });
  if (!lead) return { ok: false, error: "Lead not found." };
  try {
    // One transaction: if the property or contact cannot go, the lead stays too, and the message is true.
    type Tx = typeof db;
    await (db as unknown as { transaction: (fn: (tx: Tx) => Promise<void>) => Promise<void> }).transaction(async (tx) => {
      await tx.delete(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)));
      const otherLeadOnProperty = await tx.query.leads.findFirst({ where: and(eq(leads.propertyId, lead.propertyId), eq(leads.orgId, session.orgId)) });
      if (!otherLeadOnProperty) await tx.delete(properties).where(and(eq(properties.id, lead.propertyId), eq(properties.orgId, session.orgId)));
      if (lead.primaryContactId) {
        const [otherLead, otherLink] = await Promise.all([
          tx.query.leads.findFirst({ where: and(eq(leads.primaryContactId, lead.primaryContactId), eq(leads.orgId, session.orgId)) }),
          tx.query.propertyContacts.findFirst({ where: and(eq(propertyContacts.contactId, lead.primaryContactId), eq(propertyContacts.orgId, session.orgId)) }),
        ]);
        if (!otherLead && !otherLink) await tx.delete(contacts).where(and(eq(contacts.id, lead.primaryContactId), eq(contacts.orgId, session.orgId)));
      }
    });
    await audit(session, { entityType: "lead", entityId: leadId, action: "delete", before: lead });
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not delete the lead. Nothing was removed.") };
  }
  revalidatePath("/leads"); revalidatePath("/pipeline"); revalidatePath("/dashboard"); revalidatePath("/analyzer");
  redirect("/leads");
}

export type LeadQuickViewResult = { ok: true; data: LeadQuickView } | { ok: false; error: string };

/** Read only. Loads the data behind the pipeline quick view drawer, scoped to the caller org. */
export async function getLeadQuickView(leadId: string): Promise<LeadQuickViewResult> {
  const session = await requireSession();
  try {
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) return { ok: false, error: "Lead not found." };
    const data = await leadQuickView(session.orgId, leadId);
    if (!data) return { ok: false, error: "Lead not found." };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not load the lead." };
  }
}
