import { and, asc, count, desc, eq } from "drizzle-orm";
import { campaigns, campaignSteps, campaignEnrollments, messageTemplates, messages, leads, properties, contacts } from "@dealcalc/db";
import { getDb } from "../db";
import { isUuid } from "../safe";

export async function listCampaigns(orgId: string) {
  const db = await getDb();
  const rows = await db.select().from(campaigns).where(eq(campaigns.orgId, orgId)).orderBy(desc(campaigns.createdAt));
  const counts = await db.select({ campaignId: campaignEnrollments.campaignId, status: campaignEnrollments.status, n: count() }).from(campaignEnrollments).where(eq(campaignEnrollments.orgId, orgId)).groupBy(campaignEnrollments.campaignId, campaignEnrollments.status);
  return rows.map((c) => ({ ...c, enrolled: counts.filter((x) => x.campaignId === c.id).reduce((a, x) => a + x.n, 0), active: counts.find((x) => x.campaignId === c.id && x.status === "active")?.n ?? 0, replied: counts.find((x) => x.campaignId === c.id && x.status === "replied")?.n ?? 0 }));
}

export async function getCampaign(orgId: string, id: string) {
  if (!isUuid(id)) return null;
  const db = await getDb();
  const campaign = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, id), eq(campaigns.orgId, orgId)) });
  if (!campaign) return null;
  const [steps, enrollments, sent] = await Promise.all([
    db.select({ step: campaignSteps, template: messageTemplates }).from(campaignSteps).innerJoin(messageTemplates, eq(campaignSteps.templateId, messageTemplates.id)).where(and(eq(campaignSteps.campaignId, id), eq(campaignSteps.orgId, orgId))).orderBy(asc(campaignSteps.position)),
    db.select({ e: campaignEnrollments, address: properties.addressLine1, city: properties.city, first: contacts.firstName, last: contacts.lastName, leadId: leads.id })
      .from(campaignEnrollments).innerJoin(leads, eq(campaignEnrollments.leadId, leads.id)).innerJoin(properties, eq(leads.propertyId, properties.id)).innerJoin(contacts, eq(campaignEnrollments.contactId, contacts.id))
      .where(and(eq(campaignEnrollments.campaignId, id), eq(campaignEnrollments.orgId, orgId))).orderBy(desc(campaignEnrollments.createdAt)),
    db.select({ status: messages.status, n: count() }).from(messages).innerJoin(campaignSteps, eq(messages.campaignStepId, campaignSteps.id)).where(and(eq(campaignSteps.campaignId, id), eq(campaignSteps.orgId, orgId))).groupBy(messages.status),
  ]);
  return { campaign, steps, enrollments, sent };
}

/** Just the name, for the page title. */
export async function getCampaignName(orgId: string, id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const db = await getDb();
  const [row] = await db.select({ name: campaigns.name }).from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.orgId, orgId))).limit(1);
  return row?.name ?? null;
}

export async function listTemplates(orgId: string) {
  const db = await getDb();
  return db.select().from(messageTemplates).where(eq(messageTemplates.orgId, orgId)).orderBy(asc(messageTemplates.channel), asc(messageTemplates.name));
}
