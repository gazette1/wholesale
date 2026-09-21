import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { campaigns, campaignSteps, campaignEnrollments, leads, pipelineStages, contacts, profiles, activities } from "@dealcalc/db";
import { normalizePhone } from "@dealcalc/integrations";
import { getDb } from "../db";
import { friendlyError } from "../safe";
import { sendToLead, ConsentError } from "./messaging";

type Channel = "sms" | "email";
type ContactRow = typeof contacts.$inferSelect;

/** Why a contact cannot receive this channel, or null when sending is allowed. */
export function contactBlock(contact: ContactRow, channel: Channel): { kind: "consent" | "address"; reason: string } | null {
  if (contact.doNotContact) return { kind: "consent", reason: "The contact is marked do not contact." };
  if (channel === "sms" && contact.smsConsent === "opted_out") return { kind: "consent", reason: "The contact opted out of texts." };
  if (channel === "email" && contact.emailConsent === "opted_out") return { kind: "consent", reason: "The contact opted out of email." };
  if (channel === "sms") {
    const phone = contact.phones.find((p) => p.isPrimary)?.number ?? contact.phones[0]?.number;
    if (!phone || !normalizePhone(phone)) return { kind: "address", reason: "The contact has no usable phone number." };
  } else {
    const email = contact.emails.find((e) => e.isPrimary)?.address ?? contact.emails[0]?.address;
    if (!email) return { kind: "address", reason: "The contact has no email address." };
  }
  return null;
}

/**
 * Send every campaign step that is due. The cron route calls this for every org.
 * The Send due steps now button passes the caller's org so one workspace never sends for another.
 */
export async function dispatchDue(limit = 50, orgId?: string): Promise<{ sent: number; skipped: number; failed: number; details: string[] }> {
  const db = await getDb();
  const now = new Date();
  const where = [eq(campaignEnrollments.status, "active"), eq(campaigns.status, "active"), lte(campaignEnrollments.nextSendAt, now)];
  if (orgId) where.push(eq(campaignEnrollments.orgId, orgId), eq(campaigns.orgId, orgId));
  const due = await db.select({ e: campaignEnrollments, campaign: campaigns })
    .from(campaignEnrollments).innerJoin(campaigns, eq(campaignEnrollments.campaignId, campaigns.id))
    .where(and(...where))
    .orderBy(asc(campaignEnrollments.nextSendAt)).limit(limit);
  let sent = 0, skipped = 0, failed = 0;
  const details: string[] = [];
  for (const { e, campaign } of due) {
    const mine = and(eq(campaignEnrollments.id, e.id), eq(campaignEnrollments.orgId, e.orgId));
    /** End the enrollment and leave a note on the lead so the reason is visible. There is no reason column on the enrollment. */
    const end = async (status: "stopped" | "opted_out", reason: string) => {
      await db.update(campaignEnrollments).set({ status, nextSendAt: null }).where(mine);
      await db.insert(activities).values({ orgId: e.orgId, leadId: e.leadId, actorId: null, type: "system", payload: { text: `Campaign "${campaign.name}" stopped for this lead. ${reason}`, campaignId: campaign.id, enrollmentId: e.id } });
      details.push(`${campaign.name}: ${reason}`);
    };
    try {
      const steps = await db.select().from(campaignSteps).where(and(eq(campaignSteps.campaignId, campaign.id), eq(campaignSteps.orgId, e.orgId))).orderBy(asc(campaignSteps.position));
      const step = steps[e.currentStep];
      if (!step) {
        await db.update(campaignEnrollments).set({ status: "done", nextSendAt: null }).where(mine);
        skipped += 1; continue;
      }
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, e.leadId), eq(leads.orgId, e.orgId)) });
      if (!lead || lead.status !== "open") {
        await db.update(campaignEnrollments).set({ status: "stopped", nextSendAt: null }).where(mine);
        skipped += 1; continue;
      }
      const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, e.contactId), eq(contacts.orgId, e.orgId)) });
      if (!contact) { await end("stopped", "The contact no longer exists."); skipped += 1; continue; }
      const block = contactBlock(contact, campaign.channel);
      // A missing phone or email will not fix itself, so the enrollment stops instead of retrying every hour.
      if (block) { await end(block.kind === "consent" ? "opted_out" : "stopped", block.reason); skipped += 1; continue; }
      const sender = lead.assignedTo ? await db.query.profiles.findFirst({ where: and(eq(profiles.id, lead.assignedTo), eq(profiles.orgId, e.orgId)) }) : null;
      const template = await db.query.messageTemplates.findFirst({ where: (t, { and: all, eq: same }) => all(same(t.id, step.templateId), same(t.orgId, e.orgId)) });
      if (!template) { failed += 1; details.push(`${campaign.name}: the template for step ${e.currentStep + 1} is missing.`); continue; }
      try {
        await sendToLead({ orgId: e.orgId, senderProfileId: sender?.id ?? lead.assignedTo ?? e.orgId, senderName: sender?.fullName.split(" ")[0] ?? "Us", leadId: lead.id, contactId: e.contactId, channel: campaign.channel, body: template.body, subject: template.subject ?? undefined, templateId: template.id, campaignStepId: step.id, appUrl: process.env.APP_URL });
        const next = steps[e.currentStep + 1];
        await db.update(campaignEnrollments).set({ currentStep: e.currentStep + 1, nextSendAt: next ? new Date(now.getTime() + next.delayHours * 3_600_000) : null, status: next ? "active" : "done" }).where(mine);
        sent += 1;
      } catch (err) {
        if (err instanceof ConsentError) {
          await end("opted_out", err.message);
          skipped += 1;
        } else {
          // Provider or network trouble can clear up, so this one is tried again in an hour.
          failed += 1;
          details.push(`${campaign.name}: ${friendlyError(err, "the send failed and will be retried in an hour.")}`);
          await db.update(campaignEnrollments).set({ nextSendAt: new Date(now.getTime() + 3_600_000) }).where(mine);
        }
      }
    } catch (err) {
      failed += 1;
      details.push(`${campaign.name}: ${friendlyError(err, "this enrollment could not be processed.")}`);
    }
  }
  return { sent, skipped, failed, details };
}

export type EnrollResult = { enrolled: number; skippedConsent: number; skippedNoAddress: number };

/**
 * Enroll every open lead that matches a campaign's segment (stage keys, optional assignee) and is not already enrolled.
 * Contacts that are do not contact, opted out of the channel, or have no phone or email for it are left out.
 */
export async function enrollSegment(orgId: string, campaignId: string): Promise<EnrollResult> {
  const result: EnrollResult = { enrolled: 0, skippedConsent: 0, skippedNoAddress: 0 };
  const db = await getDb();
  const campaign = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, orgId)) });
  if (!campaign) return result;
  const seg = (campaign.segment ?? {}) as { stageKeys?: string[]; assignedTo?: string; sourceId?: string; maxAttempts?: number };
  const where = [eq(leads.orgId, orgId), eq(leads.status, "open")];
  if (seg.stageKeys?.length) {
    const stageIds = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.orgId, orgId), inArray(pipelineStages.key, seg.stageKeys)));
    if (stageIds.length === 0) return result;
    where.push(inArray(leads.stageId, stageIds.map((s) => s.id)));
  }
  if (seg.assignedTo) where.push(eq(leads.assignedTo, seg.assignedTo));
  if (seg.sourceId) where.push(eq(leads.sourceId, seg.sourceId));
  if (seg.maxAttempts != null) where.push(lte(leads.contactAttempts, seg.maxAttempts));
  const candidates = await db.select({ id: leads.id, contactId: leads.primaryContactId }).from(leads).where(and(...where));
  const existing = await db.select({ leadId: campaignEnrollments.leadId }).from(campaignEnrollments).where(and(eq(campaignEnrollments.campaignId, campaignId), eq(campaignEnrollments.orgId, orgId)));
  const skip = new Set(existing.map((x) => x.leadId));
  for (const c of candidates) {
    if (!c.contactId || skip.has(c.id)) continue;
    const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, c.contactId), eq(contacts.orgId, orgId)) });
    if (!contact) continue;
    const block = contactBlock(contact, campaign.channel);
    if (block) { if (block.kind === "consent") result.skippedConsent += 1; else result.skippedNoAddress += 1; continue; }
    await db.insert(campaignEnrollments).values({ orgId, campaignId, leadId: c.id, contactId: c.contactId, currentStep: 0, nextSendAt: campaign.startsAt && campaign.startsAt > new Date() ? campaign.startsAt : new Date(), status: "active" });
    result.enrolled += 1;
  }
  return result;
}
