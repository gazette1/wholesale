"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { leads, properties, contacts, propertyContacts, pipelineStages, activities, tasks, leadTags, tags, offers, campaignEnrollments, campaigns, profiles, dealAnalyses } from "@dealcalc/db";
import { judgmentProvider, assessDistress } from "@dealcalc/integrations";
import { getDb } from "../db";
import { requireSession, requireCan, can } from "../auth";
import { audit } from "../audit";
import { sendToLead, ConsentError } from "../services/messaging";
import { enrichProperty } from "../services/enrichment";
import { emitEvent } from "../services/integrations";
import { toNumber, toOptionalNumber } from "../utils";
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

const NewLeadSchema = z.object({
  addressLine1: z.string().min(3), addressLine2: z.string().optional(), city: z.string().min(1), state: z.string().length(2), postalCode: z.string().min(5),
  propertyType: z.string().optional(), beds: z.number().nullable(), baths: z.number().nullable(), sqft: z.number().nullable(), yearBuilt: z.number().nullable(),
  occupancy: z.enum(["owner", "tenant", "vacant", "unknown"]), condition: z.enum(["1", "2", "3", "4", "5", "unknown"]),
  firstName: z.string().min(1), lastName: z.string().optional(), phone: z.string().optional(), email: z.string().email().optional().or(z.literal("")),
  relationship: z.enum(["owner", "heir", "agent", "attorney", "tenant", "other"]), smsConsent: z.enum(["unknown", "opted_in", "opted_out"]),
  sourceId: z.string().uuid().optional().or(z.literal("")), assignedTo: z.string().uuid().optional().or(z.literal("")), askingPrice: z.number().nullable(),
  sellerUrgency: z.enum(["none", "low", "medium", "high", "immediate"]), notes: z.string().optional(), enrich: z.boolean(),
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
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    const d = parsed.data;
    const db = await getDb();
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
      phones: d.phone ? [{ number: d.phone, type: "mobile", isPrimary: true }] : [], emails: d.email ? [{ address: d.email, isPrimary: true }] : [],
    }).returning();
    await db.insert(propertyContacts).values({ orgId: session.orgId, propertyId: property!.id, contactId: contact!.id, role: d.relationship, isPrimary: true });
    const [lead] = await db.insert(leads).values({
      orgId: session.orgId, propertyId: property!.id, primaryContactId: contact!.id, stageId: stage.id, sourceId: d.sourceId || null, assignedTo: d.assignedTo || session.profileId,
      askingPrice: d.askingPrice != null ? String(d.askingPrice) : null, sellerUrgency: d.sellerUrgency, nextFollowUpAt: new Date(),
    }).returning();
    await db.insert(activities).values({ orgId: session.orgId, leadId: lead!.id, actorId: session.profileId, type: "system", payload: { text: "Lead created" } });
    if (d.notes) await db.insert(activities).values({ orgId: session.orgId, leadId: lead!.id, actorId: session.profileId, type: "note", payload: { text: d.notes } });
    await db.insert(tasks).values({ orgId: session.orgId, leadId: lead!.id, assignedTo: d.assignedTo || session.profileId, title: "First call", kind: "call", dueAt: new Date() });
    await audit(session, { entityType: "lead", entityId: lead!.id, action: "create", after: { propertyId: property!.id, contactId: contact!.id } });
    await emitEvent(session.orgId, "lead.created", { leadId: lead!.id, propertyId: property!.id, via: "app", externalId: null, address: { line1: d.addressLine1, line2: d.addressLine2 ?? null, city: d.city, state: d.state, postalCode: d.postalCode }, contact: { id: contact!.id, firstName: d.firstName, lastName: d.lastName ?? null, phone: d.phone ?? null, email: d.email || null }, askingPrice: d.askingPrice, urgency: d.sellerUrgency, source: null, sourceId: d.sourceId || null, stage: { key: stage.key, name: stage.name } });
    if (d.enrich) {
      try { await enrichProperty(session.orgId, property!.id, session.profileId); } catch { /* report page shows the failure */ }
    }
    revalidatePath("/leads"); revalidatePath("/pipeline"); revalidatePath("/dashboard");
    return { ok: true, id: lead!.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the lead." };
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
    return { ok: false, error: err instanceof Error ? err.message : "Could not move the lead." };
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
    if (form.has("assignedTo")) patch.assignedTo = String(form.get("assignedTo")) || null;
    if (form.has("nextFollowUpAt")) { const v = String(form.get("nextFollowUpAt")); patch.nextFollowUpAt = v ? new Date(v) : null; }
    if (form.has("sellerUrgency")) patch.sellerUrgency = String(form.get("sellerUrgency")) as any;
    if (form.has("motivationScore")) patch.motivationScore = toOptionalNumber(form.get("motivationScore"));
    if (form.has("askingPrice")) { const v = toOptionalNumber(form.get("askingPrice")); patch.askingPrice = v != null ? String(v) : null; }
    if (form.has("sourceId")) patch.sourceId = String(form.get("sourceId")) || null;
    if (form.has("lostReason")) patch.lostReason = String(form.get("lostReason")) || null;
    if (form.has("dealIssues")) {
      const issues: Record<string, { flagged: boolean; note?: string }> = {};
      for (const key of String(form.get("issueKeys") ?? "").split(",").filter(Boolean)) {
        const flagged = form.get(`issue_${key}`) === "on";
        const note = String(form.get(`issue_note_${key}`) ?? "").trim();
        if (flagged || note) issues[key] = { flagged, note: note || undefined };
      }
      const messyScore = Object.values(issues).filter((i) => i.flagged).length;
      patch.dealIssues = { ...issues, messyScore } as any;
    }
    await db.update(leads).set(patch).where(eq(leads.id, leadId));
    await audit(session, { entityType: "lead", entityId: leadId, action: "update", before: pick(lead, Object.keys(patch)), after: patch });
    revalidatePath(`/leads/${leadId}`); revalidatePath("/leads"); revalidatePath("/pipeline");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save." };
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
    const type = String(form.get("type") ?? "note") as "note" | "call";
    const text = String(form.get("text") ?? "").trim();
    const outcome = String(form.get("outcome") ?? "");
    if (!text && type === "note") return { ok: false, error: "Write a note first." };
    await db.insert(activities).values({ orgId: session.orgId, leadId, actorId: session.profileId, type, payload: { text, outcome } });
    if (type === "call") {
      await db.update(leads).set({ lastContactAt: new Date(), contactAttempts: sql`${leads.contactAttempts} + 1`, firstResponseMinutes: outcome === "spoke" && lead.firstResponseMinutes == null ? Math.max(1, Math.round((Date.now() - new Date(lead.createdAt).getTime()) / 60_000)) : lead.firstResponseMinutes }).where(eq(leads.id, leadId));
    }
    // Suggest deal issues from the note through the judgment provider; only stored as suggestions.
    if (text.length > 20) {
      try {
        const assessment = await assessDistress(judgmentProvider(), text);
        const strong = Object.entries(assessment.signals).filter(([, p]) => p >= 0.6).map(([k]) => k);
        if (strong.length) await db.insert(activities).values({ orgId: session.orgId, leadId, actorId: null, type: "system", payload: { text: `Suggested deal issues from notes (${assessment.provider}): ${strong.join(", ")}`, suggestions: assessment.signals, motivationScore: assessment.motivationScore } });
      } catch { /* judgment is optional */ }
    }
    const next = parseLocalDateTime(String(form.get("nextFollowUpAt") ?? ""), form.get("tzOffset") as string | null);
    if (next) await db.update(leads).set({ nextFollowUpAt: next }).where(and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)));
    revalidatePath(`/leads/${leadId}`); revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not log that." };
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
    if (leadId) await db.update(leads).set({ nextFollowUpAt: dueAt }).where(and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)));
    revalidatePath(leadId ? `/leads/${leadId}` : "/tasks"); revalidatePath("/tasks"); revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not add the task." };
  }
}

export async function completeTask(taskId: string, done: boolean): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role === "viewer") return { ok: false, error: "Your role (viewer) is read only." };
  const db = await getDb();
  const task = await db.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.orgId, session.orgId)) });
  if (!task) return { ok: false, error: "Task not found." };
  await db.update(tasks).set({ doneAt: done ? new Date() : null }).where(and(eq(tasks.id, taskId), eq(tasks.orgId, session.orgId)));
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
  await db.insert(tags).values({ orgId: session.orgId, name, kind, color }).onConflictDoNothing();
  revalidatePath("/settings"); revalidatePath("/leads");
  return { ok: true };
}

export async function sendMessage(leadId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "message:send");
    const channel = String(form.get("channel") ?? "sms") as "sms" | "email";
    const body = String(form.get("body") ?? "").trim();
    if (!body) return { ok: false, error: "Message is empty." };
    const contactId = String(form.get("contactId") ?? "");
    await sendToLead({ orgId: session.orgId, senderProfileId: session.profileId, senderName: session.fullName.split(" ")[0] ?? session.fullName, leadId, contactId, channel, body, subject: String(form.get("subject") ?? "") || undefined, templateId: String(form.get("templateId") ?? "") || null, appUrl: process.env.APP_URL });
    revalidatePath(`/leads/${leadId}`); revalidatePath("/dashboard");
    return { ok: true, message: "Sent" };
  } catch (err) {
    if (err instanceof ConsentError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Could not send." };
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
    const owned = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) });
    if (!owned) return { ok: false, error: "Lead not found." };
    const statusRaw = String(form.get("status") ?? "sent");
    const status = (["draft", "sent", "countered", "accepted", "rejected", "expired"].includes(statusRaw) ? statusRaw : "sent") as "sent";
    const analysisIdRaw = String(form.get("analysisId") ?? "") || null;
    const linked = analysisIdRaw ? await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisIdRaw), eq(dealAnalyses.orgId, session.orgId), eq(dealAnalyses.propertyId, owned.propertyId)) }) : null;
    if (analysisIdRaw && !linked) return { ok: false, error: "That analysis does not belong to this lead." };
    const [offer] = await db.insert(offers).values({ orgId: session.orgId, leadId, analysisId: linked?.id ?? null, amount: String(amount), type: (String(form.get("type") || "cash")) as any, status, sentAt: status === "sent" ? new Date() : null, sentVia: String(form.get("sentVia") ?? "") || null, notes: String(form.get("notes") ?? "") || null, createdBy: session.profileId }).returning();
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

export async function updateOfferStatus(offerId: string, leadId: string, status: "accepted" | "rejected" | "countered" | "expired", counterAmount?: number): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "lead:write")) return { ok: false, error: `Your role (${session.role}) cannot change offers.` };
  const db = await getDb();
  const offer = await db.query.offers.findFirst({ where: and(eq(offers.id, offerId), eq(offers.orgId, session.orgId)) });
  if (!offer) return { ok: false, error: "Offer not found." };
  // The lead comes from the offer row, never from the caller.
  leadId = offer.leadId;
  if (counterAmount != null && !(Number.isFinite(counterAmount) && counterAmount > 0)) return { ok: false, error: "Counter amount must be positive." };
  await db.update(offers).set({ status, counterAmount: counterAmount != null ? String(counterAmount) : offer.counterAmount }).where(and(eq(offers.id, offerId), eq(offers.orgId, session.orgId)));
  await db.insert(activities).values({ orgId: session.orgId, leadId, actorId: session.profileId, type: "offer", payload: { offerId, status, counterAmount } });
  await audit(session, { entityType: "offer", entityId: offerId, action: "status", before: { status: offer.status }, after: { status, counterAmount } });
  await emitEvent(session.orgId, "offer.status_changed", { offerId, leadId, amount: Number(offer.amount), from: offer.status, to: status, counterAmount: counterAmount ?? null });
  if (status === "accepted") {
    const stage = await db.query.pipelineStages.findFirst({ where: and(eq(pipelineStages.orgId, session.orgId), eq(pipelineStages.key, "under_contract")) });
    if (stage) await moveLeadStage(leadId, stage.id);
  }
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

export async function runEnrichment(propertyId: string, leadId?: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    const { report, compCount } = await enrichProperty(session.orgId, propertyId, session.profileId);
    if (leadId) revalidatePath(`/leads/${leadId}`);
    revalidatePath(`/properties/${propertyId}/report`);
    return report.status === "failed" ? { ok: false, error: report.error ?? "Provider failed." } : { ok: true, message: `Report from ${report.provider}, ${compCount} comps` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Enrichment failed." };
  }
}

export async function enrollInCampaign(leadId: string, campaignId: string): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "campaign:write");
  const db = await getDb();
  const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) });
  const campaign = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)) });
  if (!lead?.primaryContactId || !campaign) return { ok: false, error: "Lead needs a primary contact and the campaign must exist." };
  await db.insert(campaignEnrollments).values({ orgId: session.orgId, campaignId, leadId, contactId: lead.primaryContactId, currentStep: 0, nextSendAt: new Date(), status: "active" });
  revalidatePath(`/leads/${leadId}`); revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true, message: `Enrolled in ${campaign.name}` };
}

export async function deleteLead(leadId: string): Promise<never | ActionResult> {
  const session = await requireSession();
  if (session.role !== "admin") return { ok: false, error: "Only admins delete leads." };
  const db = await getDb();
  const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) });
  if (!lead) return { ok: false, error: "Lead not found." };
  await audit(session, { entityType: "lead", entityId: leadId, action: "delete", before: lead });
  await db.delete(leads).where(eq(leads.id, leadId));
  revalidatePath("/leads"); revalidatePath("/pipeline");
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
