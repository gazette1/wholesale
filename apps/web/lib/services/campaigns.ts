import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { campaigns, campaignSteps, campaignEnrollments, leads, pipelineStages, contacts, profiles, tasks } from "@dealcalc/db";
import { getDb } from "../db";
import { sendToLead, ConsentError } from "./messaging";

/**
 * Send every campaign step that is due. Called by /api/cron/dispatch every
 * minute in production and by the Run now button in development.
 */
export async function dispatchDue(limit = 50): Promise<{ sent: number; skipped: number; failed: number; details: string[] }> {
  const db = await getDb();
  const now = new Date();
  const due = await db.select({ e: campaignEnrollments, campaign: campaigns })
    .from(campaignEnrollments).innerJoin(campaigns, eq(campaignEnrollments.campaignId, campaigns.id))
    .where(and(eq(campaignEnrollments.status, "active"), eq(campaigns.status, "active"), lte(campaignEnrollments.nextSendAt, now)))
    .orderBy(asc(campaignEnrollments.nextSendAt)).limit(limit);
  let sent = 0, skipped = 0, failed = 0;
  const details: string[] = [];
  for (const { e, campaign } of due) {
    const steps = await db.select().from(campaignSteps).where(eq(campaignSteps.campaignId, campaign.id)).orderBy(asc(campaignSteps.position));
    const step = steps[e.currentStep];
    if (!step) {
      await db.update(campaignEnrollments).set({ status: "done", nextSendAt: null }).where(eq(campaignEnrollments.id, e.id));
      skipped += 1; continue;
    }
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, e.leadId) });
    if (!lead || lead.status !== "open") {
      await db.update(campaignEnrollments).set({ status: "stopped", nextSendAt: null }).where(eq(campaignEnrollments.id, e.id));
      skipped += 1; continue;
    }
    const sender = lead.assignedTo ? await db.query.profiles.findFirst({ where: eq(profiles.id, lead.assignedTo) }) : null;
    const template = await db.query.messageTemplates.findFirst({ where: (t, { eq }) => eq(t.id, step.templateId) });
    if (!template) { failed += 1; details.push(`Template missing for step ${step.id}`); continue; }
    try {
      await sendToLead({ orgId: e.orgId, senderProfileId: sender?.id ?? lead.assignedTo ?? e.orgId, senderName: sender?.fullName.split(" ")[0] ?? "Us", leadId: lead.id, contactId: e.contactId, channel: campaign.channel, body: template.body, subject: template.subject ?? undefined, templateId: template.id, campaignStepId: step.id, appUrl: process.env.APP_URL });
      const next = steps[e.currentStep + 1];
      await db.update(campaignEnrollments).set({ currentStep: e.currentStep + 1, nextSendAt: next ? new Date(now.getTime() + next.delayHours * 3_600_000) : null, status: next ? "active" : "done" }).where(eq(campaignEnrollments.id, e.id));
      sent += 1;
    } catch (err) {
      if (err instanceof ConsentError) {
        await db.update(campaignEnrollments).set({ status: "opted_out", nextSendAt: null }).where(eq(campaignEnrollments.id, e.id));
        skipped += 1;
      } else {
        failed += 1;
        details.push(`${lead.id}: ${err instanceof Error ? err.message : String(err)}`);
        await db.update(campaignEnrollments).set({ nextSendAt: new Date(now.getTime() + 3_600_000) }).where(eq(campaignEnrollments.id, e.id));
      }
    }
  }
  return { sent, skipped, failed, details };
}

/** Enroll every open lead that matches a campaign's segment (stage keys, optional assignee) and is not already enrolled. */
export async function enrollSegment(orgId: string, campaignId: string): Promise<number> {
  const db = await getDb();
  const campaign = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, orgId)) });
  if (!campaign) return 0;
  const seg = (campaign.segment ?? {}) as { stageKeys?: string[]; assignedTo?: string; sourceId?: string; maxAttempts?: number };
  const where = [eq(leads.orgId, orgId), eq(leads.status, "open")];
  if (seg.stageKeys?.length) {
    const stageIds = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.orgId, orgId), inArray(pipelineStages.key, seg.stageKeys)));
    where.push(inArray(leads.stageId, stageIds.map((s) => s.id)));
  }
  if (seg.assignedTo) where.push(eq(leads.assignedTo, seg.assignedTo));
  if (seg.sourceId) where.push(eq(leads.sourceId, seg.sourceId));
  if (seg.maxAttempts != null) where.push(lte(leads.contactAttempts, seg.maxAttempts));
  const candidates = await db.select({ id: leads.id, contactId: leads.primaryContactId }).from(leads).where(and(...where));
  const existing = await db.select({ leadId: campaignEnrollments.leadId }).from(campaignEnrollments).where(eq(campaignEnrollments.campaignId, campaignId));
  const skip = new Set(existing.map((x) => x.leadId));
  let n = 0;
  for (const c of candidates) {
    if (!c.contactId || skip.has(c.id)) continue;
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, c.contactId) });
    if (!contact || contact.doNotContact || (campaign.channel === "sms" && contact.smsConsent === "opted_out")) continue;
    await db.insert(campaignEnrollments).values({ orgId, campaignId, leadId: c.id, contactId: c.contactId, currentStep: 0, nextSendAt: campaign.startsAt && campaign.startsAt > new Date() ? campaign.startsAt : new Date(), status: "active" });
    n += 1;
  }
  return n;
}
