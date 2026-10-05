"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, count, eq, max } from "drizzle-orm";
import { campaigns, campaignSteps, campaignEnrollments, messageTemplates, messages, pipelineStages, contacts } from "@dealcalc/db";
import { getDb } from "../db";
import { requireSession, requireCan, type Session } from "../auth";
import { audit } from "../audit";
import { friendlyError, isUuid, numberField, textField } from "../safe";
import { MERGE_FIELD_HELP, unknownMergeFields, mergeFieldsIn, SMS_MAX_CHARS, EMAIL_MAX_CHARS, SUBJECT_MAX_CHARS, TEMPLATE_NAME_MAX_CHARS } from "../template-fields";
import { contactBlock, dispatchDue, enrollSegment } from "../services/campaigns";
import type { ActionResult } from "./leads";

type Db = Awaited<ReturnType<typeof getDb>>;
type Channel = "sms" | "email";
type Status = "draft" | "active" | "paused" | "done";
const STATUSES: Status[] = ["draft", "active", "paused", "done"];
const STATUS_LABEL: Record<Status, string> = { draft: "moved back to draft", active: "activated", paused: "paused", done: "marked done" };
const MAX_DELAY_HOURS = 8760;
const NOT_FOUND = "Campaign not found.";

function channelOf(raw: FormDataEntryValue | null): Channel | null {
  return raw === "sms" || raw === "email" ? raw : null;
}

/** Permission check, database handle, try and catch. An action that throws blanks the page, so nothing gets out of here. */
async function guarded(session: Session, fallback: string, fn: (db: Db) => Promise<ActionResult>): Promise<ActionResult> {
  try {
    requireCan(session, "campaign:write");
    return await fn(await getDb());
  } catch (err) {
    return { ok: false, error: friendlyError(err, fallback) };
  }
}

/** Reads the segment fields shared by create and edit. Stage keys must be real stages of this org. */
async function readSegment(db: Db, orgId: string, form: FormData): Promise<{ ok: true; stageKeys: string[]; maxAttempts: number | undefined } | { ok: false; error: string }> {
  const asked = Array.from(new Set(form.getAll("stageKeys").flatMap((v) => String(v).split(",")).map((s) => s.trim()).filter(Boolean)));
  const stages = await db.select({ key: pipelineStages.key }).from(pipelineStages).where(eq(pipelineStages.orgId, orgId)).orderBy(asc(pipelineStages.position));
  const valid = new Set(stages.map((s) => s.key));
  const unknown = asked.filter((k) => !valid.has(k));
  if (unknown.length) return { ok: false, error: `Unknown stage: ${unknown.join(", ").slice(0, 120)}. Valid stages: ${stages.map((s) => s.key).join(", ")}.` };
  const attempts = numberField(form.get("maxAttempts"), "Max attempts", 0, 20, { integer: true });
  if (!attempts.ok) return attempts;
  return { ok: true, stageKeys: asked, maxAttempts: attempts.value ?? undefined };
}

export async function createCampaign(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  let id = "";
  const result = await guarded(session, "Could not create the campaign.", async (db) => {
    const name = textField(form.get("name"), 120);
    if (!name) return { ok: false, error: "Campaign needs a name." };
    const channel = channelOf(form.get("channel"));
    if (!channel) return { ok: false, error: "Pick text or email." };
    const seg = await readSegment(db, session.orgId, form);
    if (!seg.ok) return seg;
    const segment = { stageKeys: seg.stageKeys, maxAttempts: seg.maxAttempts };
    const [c] = await db.insert(campaigns).values({ orgId: session.orgId, name, channel, status: "draft", segment, createdBy: session.profileId }).returning();
    id = c!.id;
    await audit(session, { entityType: "campaign", entityId: id, action: "create", after: { name, channel, segment } });
    revalidatePath("/campaigns");
    return { ok: true };
  });
  if (!result.ok || !id) return result;
  redirect(`/campaigns/${id}`);
}

export async function updateCampaign(campaignId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  return guarded(session, "Could not save the campaign.", async (db) => {
    if (!isUuid(campaignId)) return { ok: false, error: NOT_FOUND };
    const c = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)) });
    if (!c) return { ok: false, error: NOT_FOUND };
    const name = textField(form.get("name"), 120);
    if (!name) return { ok: false, error: "Campaign needs a name." };
    const seg = await readSegment(db, session.orgId, form);
    if (!seg.ok) return seg;
    // Assignee and source filters are not on this form, so they carry over untouched.
    const segment = { ...(c.segment ?? {}), stageKeys: seg.stageKeys, maxAttempts: seg.maxAttempts };
    await db.update(campaigns).set({ name, segment }).where(and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)));
    await audit(session, { entityType: "campaign", entityId: campaignId, action: "update", before: { name: c.name, segment: c.segment }, after: { name, segment } });
    revalidatePath(`/campaigns/${campaignId}`); revalidatePath("/campaigns");
    return { ok: true, message: "Campaign saved" };
  });
}

export async function deleteCampaign(campaignId: string): Promise<ActionResult> {
  const session = await requireSession();
  const result = await guarded(session, "Could not delete the campaign.", async (db) => {
    if (!isUuid(campaignId)) return { ok: false, error: NOT_FOUND };
    const c = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)) });
    if (!c) return { ok: false, error: NOT_FOUND };
    const [sent] = await db.select({ n: count() }).from(messages).innerJoin(campaignSteps, eq(messages.campaignStepId, campaignSteps.id)).where(and(eq(campaignSteps.campaignId, campaignId), eq(campaignSteps.orgId, session.orgId)));
    if ((sent?.n ?? 0) > 0) return { ok: false, error: `This campaign has sent ${sent!.n} message${sent!.n === 1 ? "" : "s"}, so it is kept for the record. Mark it done instead.` };
    await audit(session, { entityType: "campaign", entityId: campaignId, action: "delete", before: { name: c.name, channel: c.channel, status: c.status, segment: c.segment } });
    await db.delete(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)));
    revalidatePath("/campaigns");
    return { ok: true };
  });
  if (!result.ok) return result;
  redirect("/campaigns");
}

export async function addStep(campaignId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  return guarded(session, "Could not add the step.", async (db) => {
    if (!isUuid(campaignId)) return { ok: false, error: NOT_FOUND };
    const c = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)) });
    if (!c) return { ok: false, error: NOT_FOUND };
    const templateId = String(form.get("templateId") ?? "");
    if (!templateId) return { ok: false, error: "Pick a template." };
    const template = isUuid(templateId) ? await db.query.messageTemplates.findFirst({ where: and(eq(messageTemplates.id, templateId), eq(messageTemplates.orgId, session.orgId)) }) : null;
    if (!template) return { ok: false, error: "Template not found." };
    if (template.channel !== c.channel) return { ok: false, error: `This is ${c.channel === "sms" ? "a text" : "an email"} campaign. Pick ${c.channel === "sms" ? "a text" : "an email"} template.` };
    if (!template.active) return { ok: false, error: "That template is inactive." };
    const [pos] = await db.select({ p: max(campaignSteps.position), n: count() }).from(campaignSteps).where(and(eq(campaignSteps.campaignId, campaignId), eq(campaignSteps.orgId, session.orgId)));
    const first = (pos?.n ?? 0) === 0;
    const delay = numberField(form.get("delayHours"), "Delay hours", 0, MAX_DELAY_HOURS, { integer: true });
    if (!delay.ok) return delay;
    // The first step goes out when a lead is enrolled, so it never has a delay. Store 0 so the data says the same thing as the screen.
    const delayHours = first ? 0 : delay.value ?? 24;
    const [step] = await db.insert(campaignSteps).values({ orgId: session.orgId, campaignId, position: (pos?.p ?? 0) + 1, delayHours, templateId, stopOnReply: form.get("stopOnReply") !== "off" }).returning();
    await audit(session, { entityType: "campaign_step", entityId: step!.id, action: "create", after: { name: `${c.name}: ${template.name}`, campaignId, position: step!.position, delayHours, templateId } });
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, message: first ? "Step added. It sends at enrollment." : `Step added. It sends ${delayHours}h after the previous step.` };
  });
}

export async function removeStep(campaignId: string, stepId: string): Promise<ActionResult> {
  const session = await requireSession();
  return guarded(session, "Could not remove the step.", async (db) => {
    if (!isUuid(campaignId) || !isUuid(stepId)) return { ok: false, error: "Step not found." };
    const c = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)) });
    const step = c ? await db.query.campaignSteps.findFirst({ where: and(eq(campaignSteps.id, stepId), eq(campaignSteps.campaignId, campaignId), eq(campaignSteps.orgId, session.orgId)) }) : null;
    if (!c || !step) return { ok: false, error: "Step not found." };
    // Enrollments track their place by step number. Taking a step out from under them would skip or repeat a message.
    const [live] = await db.select({ n: count() }).from(campaignEnrollments).where(and(eq(campaignEnrollments.campaignId, campaignId), eq(campaignEnrollments.orgId, session.orgId), eq(campaignEnrollments.status, "active")));
    if (c.status === "active" || (live?.n ?? 0) > 0) return { ok: false, error: "Pause the campaign and stop its active enrollments before removing a step." };
    await db.delete(campaignSteps).where(and(eq(campaignSteps.id, stepId), eq(campaignSteps.orgId, session.orgId)));
    // Whatever is first now sends at enrollment, so it carries no delay.
    const [head] = await db.select().from(campaignSteps).where(and(eq(campaignSteps.campaignId, campaignId), eq(campaignSteps.orgId, session.orgId))).orderBy(asc(campaignSteps.position)).limit(1);
    if (head && head.delayHours !== 0) await db.update(campaignSteps).set({ delayHours: 0 }).where(and(eq(campaignSteps.id, head.id), eq(campaignSteps.orgId, session.orgId)));
    await audit(session, { entityType: "campaign_step", entityId: stepId, action: "delete", before: { name: `${c.name}: step ${step.position}`, campaignId, position: step.position, delayHours: step.delayHours, templateId: step.templateId } });
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, message: "Step removed" };
  });
}

export async function setCampaignStatus(campaignId: string, status: Status): Promise<ActionResult> {
  const session = await requireSession();
  return guarded(session, "Could not change the status.", async (db) => {
    if (!isUuid(campaignId)) return { ok: false, error: NOT_FOUND };
    if (!STATUSES.includes(status)) return { ok: false, error: "That is not a campaign status." };
    const c = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)) });
    if (!c) return { ok: false, error: NOT_FOUND };
    if (status === "active") {
      const [steps] = await db.select({ n: count() }).from(campaignSteps).where(and(eq(campaignSteps.campaignId, campaignId), eq(campaignSteps.orgId, session.orgId)));
      if ((steps?.n ?? 0) === 0) return { ok: false, error: "Add at least one step before activating." };
    }
    await db.update(campaigns).set({ status }).where(and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)));
    await audit(session, { entityType: "campaign", entityId: campaignId, action: "status", before: { name: c.name, status: c.status }, after: { name: c.name, status } });
    revalidatePath(`/campaigns/${campaignId}`); revalidatePath("/campaigns");
    return { ok: true, message: `Campaign ${STATUS_LABEL[status]}` };
  });
}

export async function enrollMatching(campaignId: string): Promise<ActionResult> {
  const session = await requireSession();
  return guarded(session, "Could not enroll leads.", async (db) => {
    if (!isUuid(campaignId)) return { ok: false, error: NOT_FOUND };
    const c = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)) });
    if (!c) return { ok: false, error: NOT_FOUND };
    if (c.status === "done") return { ok: false, error: "This campaign is marked done. Move it back to draft to enroll more leads." };
    const [steps] = await db.select({ n: count() }).from(campaignSteps).where(and(eq(campaignSteps.campaignId, campaignId), eq(campaignSteps.orgId, session.orgId)));
    if ((steps?.n ?? 0) === 0) return { ok: false, error: "Add at least one step before enrolling leads." };
    const r = await enrollSegment(session.orgId, campaignId);
    await audit(session, { entityType: "campaign", entityId: campaignId, action: "enroll", after: { name: c.name, ...r } });
    revalidatePath(`/campaigns/${campaignId}`); revalidatePath("/campaigns");
    const notes = [r.skippedConsent ? `${r.skippedConsent} skipped for opt out or do not contact` : "", r.skippedNoAddress ? `${r.skippedNoAddress} skipped with no ${c.channel === "sms" ? "phone number" : "email address"}` : ""].filter(Boolean);
    return { ok: true, message: `Enrolled ${r.enrolled} lead${r.enrolled === 1 ? "" : "s"}${notes.length ? `, ${notes.join(", ")}` : ""}` };
  });
}

export async function stopEnrollment(enrollmentId: string, campaignId: string): Promise<ActionResult> {
  const session = await requireSession();
  return guarded(session, "Could not stop the enrollment.", async (db) => {
    if (!isUuid(enrollmentId) || !isUuid(campaignId)) return { ok: false, error: "Enrollment not found." };
    const e = await db.query.campaignEnrollments.findFirst({ where: and(eq(campaignEnrollments.id, enrollmentId), eq(campaignEnrollments.campaignId, campaignId), eq(campaignEnrollments.orgId, session.orgId)) });
    if (!e) return { ok: false, error: "Enrollment not found." };
    if (e.status !== "active") return { ok: false, error: "This enrollment is not active." };
    await db.update(campaignEnrollments).set({ status: "stopped", nextSendAt: null }).where(and(eq(campaignEnrollments.id, enrollmentId), eq(campaignEnrollments.orgId, session.orgId)));
    await audit(session, { entityType: "campaign_enrollment", entityId: enrollmentId, action: "stop", before: { status: e.status, currentStep: e.currentStep, leadId: e.leadId }, after: { status: "stopped" } });
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, message: "Enrollment stopped" };
  });
}

/** Put a stopped enrollment back in the queue at the step where it left off. */
export async function resumeEnrollment(enrollmentId: string, campaignId: string): Promise<ActionResult> {
  const session = await requireSession();
  return guarded(session, "Could not resume the enrollment.", async (db) => {
    if (!isUuid(enrollmentId) || !isUuid(campaignId)) return { ok: false, error: "Enrollment not found." };
    const e = await db.query.campaignEnrollments.findFirst({ where: and(eq(campaignEnrollments.id, enrollmentId), eq(campaignEnrollments.campaignId, campaignId), eq(campaignEnrollments.orgId, session.orgId)) });
    const c = e ? await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)) }) : null;
    if (!e || !c) return { ok: false, error: "Enrollment not found." };
    if (e.status !== "stopped") return { ok: false, error: "Only a stopped enrollment can be resumed." };
    const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, e.contactId), eq(contacts.orgId, session.orgId)) });
    if (!contact) return { ok: false, error: "The contact no longer exists." };
    const block = contactBlock(contact, c.channel);
    if (block) return { ok: false, error: `${block.reason} Fix that on the lead first.` };
    await db.update(campaignEnrollments).set({ status: "active", nextSendAt: new Date() }).where(and(eq(campaignEnrollments.id, enrollmentId), eq(campaignEnrollments.orgId, session.orgId)));
    await audit(session, { entityType: "campaign_enrollment", entityId: enrollmentId, action: "resume", before: { status: e.status }, after: { status: "active", currentStep: e.currentStep, leadId: e.leadId } });
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, message: "Enrollment resumed" };
  });
}

export async function runDispatchNow(): Promise<ActionResult> {
  const session = await requireSession();
  return guarded(session, "Could not send due steps.", async () => {
    // Only this workspace. The cron route is the one caller that sends for every org.
    const r = await dispatchDue(100, session.orgId);
    await audit(session, { entityType: "campaign_dispatch", entityId: session.orgId, action: "run", after: { sent: r.sent, skipped: r.skipped, failed: r.failed, details: r.details.slice(0, 10) } });
    revalidatePath("/campaigns");
    return { ok: true, message: `Sent ${r.sent}, skipped ${r.skipped}, failed ${r.failed}${r.details.length ? `. ${r.details[0]}` : ""}` };
  });
}

export async function saveTemplate(templateId: string | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  return guarded(session, "Could not save the template.", async (db) => {
    if (templateId !== null && !isUuid(templateId)) return { ok: false, error: "Template not found." };
    const channel = channelOf(form.get("channel"));
    if (!channel) return { ok: false, error: "Pick text or email." };
    const name = String(form.get("name") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    const subject = channel === "email" ? String(form.get("subject") ?? "").trim() : "";
    if (!name || !body) return { ok: false, error: "Name and body are required." };
    if (name.length > TEMPLATE_NAME_MAX_CHARS) return { ok: false, error: `Name must be ${TEMPLATE_NAME_MAX_CHARS} characters or fewer.` };
    if (channel === "email" && !subject) return { ok: false, error: "An email template needs a subject." };
    if (subject.length > SUBJECT_MAX_CHARS) return { ok: false, error: `Subject must be ${SUBJECT_MAX_CHARS} characters or fewer.` };
    const limit = channel === "sms" ? SMS_MAX_CHARS : EMAIL_MAX_CHARS;
    if (body.length > limit) return { ok: false, error: `Body must be ${limit.toLocaleString("en-US")} characters or fewer. It has ${body.length.toLocaleString("en-US")}.` };
    const unknown = unknownMergeFields(`${subject}\n${body}`);
    if (unknown.length) return { ok: false, error: `Unknown merge field: ${unknown.map((f) => `{{${f}}}`).join(", ").slice(0, 160)}. Valid fields: ${MERGE_FIELD_HELP}.` };
    const values = { channel, name, subject: subject || null, body, mergeFields: mergeFieldsIn(`${subject}\n${body}`), active: form.get("active") !== "off" };
    if (templateId) {
      const before = await db.query.messageTemplates.findFirst({ where: and(eq(messageTemplates.id, templateId), eq(messageTemplates.orgId, session.orgId)) });
      if (!before) return { ok: false, error: "Template not found." };
      if (before.channel !== channel) {
        const [used] = await db.select({ n: count() }).from(campaignSteps).where(and(eq(campaignSteps.templateId, templateId), eq(campaignSteps.orgId, session.orgId)));
        if ((used?.n ?? 0) > 0) return { ok: false, error: "This template is used by a campaign step, so its channel cannot change. Create a new template instead." };
      }
      await db.update(messageTemplates).set(values).where(and(eq(messageTemplates.id, templateId), eq(messageTemplates.orgId, session.orgId)));
      await audit(session, { entityType: "template", entityId: templateId, action: "update", before: { name: before.name, channel: before.channel, subject: before.subject, body: before.body, active: before.active }, after: { name, channel, subject: values.subject, body, active: values.active } });
    } else {
      const [t] = await db.insert(messageTemplates).values({ orgId: session.orgId, ...values }).returning();
      await audit(session, { entityType: "template", entityId: t!.id, action: "create", after: { name, channel, subject: values.subject, body } });
    }
    revalidatePath("/templates");
    return { ok: true, message: templateId ? "Template saved" : "Template created" };
  });
}

export async function deleteTemplate(templateId: string): Promise<ActionResult> {
  const session = await requireSession();
  return guarded(session, "Could not delete the template. It may be used by a campaign step.", async (db) => {
    if (!isUuid(templateId)) return { ok: false, error: "Template not found." };
    const t = await db.query.messageTemplates.findFirst({ where: and(eq(messageTemplates.id, templateId), eq(messageTemplates.orgId, session.orgId)) });
    if (!t) return { ok: false, error: "Template not found." };
    const [used] = await db.select({ n: count() }).from(campaignSteps).where(and(eq(campaignSteps.templateId, templateId), eq(campaignSteps.orgId, session.orgId)));
    if ((used?.n ?? 0) > 0) return { ok: false, error: "This template is used by a campaign step. Remove the step first." };
    await db.delete(messageTemplates).where(and(eq(messageTemplates.id, templateId), eq(messageTemplates.orgId, session.orgId)));
    await audit(session, { entityType: "template", entityId: templateId, action: "delete", before: { name: t.name, channel: t.channel, subject: t.subject, body: t.body } });
    revalidatePath("/templates");
    return { ok: true, message: "Template deleted" };
  });
}
