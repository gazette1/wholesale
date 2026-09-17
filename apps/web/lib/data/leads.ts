import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql, count } from "drizzle-orm";
import {
  leads, properties, contacts, pipelineStages, leadSources, profiles, tags, leadTags, activities, tasks, offers, messages,
  dealAnalyses, propertyReports, propertyContacts, documents, comps, campaignEnrollments, campaigns,
} from "@dealcalc/db";
import { getDb } from "../db";

export type LeadFilters = {
  q?: string; stage?: string; assigned?: string; source?: string; status?: string; tag?: string; due?: "today" | "overdue" | "week";
  sort?: string; dir?: "asc" | "desc"; page?: number; pageSize?: number; issue?: string;
};

export async function listStages(orgId: string) {
  const db = await getDb();
  return db.select().from(pipelineStages).where(eq(pipelineStages.orgId, orgId)).orderBy(asc(pipelineStages.position));
}

export async function listProfiles(orgId: string) {
  const db = await getDb();
  return db.select().from(profiles).where(and(eq(profiles.orgId, orgId), eq(profiles.active, true))).orderBy(asc(profiles.fullName));
}

export async function listSources(orgId: string) {
  const db = await getDb();
  return db.select().from(leadSources).where(eq(leadSources.orgId, orgId)).orderBy(asc(leadSources.name));
}

export async function listTags(orgId: string, kind?: "lead" | "buyer" | "issue") {
  const db = await getDb();
  return db.select().from(tags).where(kind ? and(eq(tags.orgId, orgId), eq(tags.kind, kind)) : eq(tags.orgId, orgId)).orderBy(asc(tags.name));
}

const SORTS: Record<string, any> = {
  created: leads.createdAt, followUp: leads.nextFollowUpAt, lastContact: leads.lastContactAt, attempts: leads.contactAttempts,
  motivation: leads.motivationScore, asking: leads.askingPrice, address: properties.addressLine1, stage: pipelineStages.position,
};

export async function listLeads(orgId: string, f: LeadFilters = {}) {
  const db = await getDb();
  const where = [eq(leads.orgId, orgId)];
  if (f.status && f.status !== "all") where.push(eq(leads.status, f.status as any));
  else if (!f.status) where.push(eq(leads.status, "open"));
  if (f.stage) where.push(eq(pipelineStages.key, f.stage));
  if (f.assigned === "unassigned") where.push(isNull(leads.assignedTo));
  else if (f.assigned) where.push(eq(leads.assignedTo, f.assigned));
  if (f.source) where.push(eq(leadSources.name, f.source));
  if (f.q) {
    const like = `%${f.q}%`;
    where.push(or(ilike(properties.addressLine1, like), ilike(properties.city, like), ilike(properties.postalCode, like), ilike(contacts.firstName, like), ilike(contacts.lastName, like), sql`${contacts.phones}::text ilike ${like}`)!);
  }
  const now = new Date();
  if (f.due === "overdue") where.push(lte(leads.nextFollowUpAt, now));
  if (f.due === "today") { const end = new Date(now); end.setHours(23, 59, 59, 999); where.push(lte(leads.nextFollowUpAt, end)); }
  if (f.due === "week") where.push(lte(leads.nextFollowUpAt, new Date(now.getTime() + 7 * 86_400_000)));
  if (f.issue) where.push(sql`coalesce((${leads.dealIssues} -> ${f.issue} ->> 'flagged')::boolean, false)`);
  if (f.tag) {
    const tagged = db.select({ id: leadTags.leadId }).from(leadTags).innerJoin(tags, eq(leadTags.tagId, tags.id)).where(and(eq(tags.orgId, orgId), eq(tags.name, f.tag)));
    where.push(inArray(leads.id, tagged));
  }
  const sortCol = SORTS[f.sort ?? "created"] ?? leads.createdAt;
  const order = (f.dir ?? (f.sort ? "asc" : "desc")) === "asc" ? asc(sortCol) : desc(sortCol);
  const pageSize = f.pageSize ?? 50;
  const page = Math.max(1, f.page ?? 1);

  const base = db.select({
    id: leads.id, status: leads.status, createdAt: leads.createdAt, nextFollowUpAt: leads.nextFollowUpAt, lastContactAt: leads.lastContactAt,
    contactAttempts: leads.contactAttempts, motivationScore: leads.motivationScore, sellerUrgency: leads.sellerUrgency, askingPrice: leads.askingPrice, dealIssues: leads.dealIssues,
    propertyId: leads.propertyId, address: properties.addressLine1, city: properties.city, state: properties.state, postalCode: properties.postalCode, beds: properties.beds, baths: properties.baths, sqft: properties.sqft,
    stageId: pipelineStages.id, stageKey: pipelineStages.key, stageName: pipelineStages.name, stageColor: pipelineStages.color, stagePosition: pipelineStages.position,
    source: leadSources.name, assignedId: profiles.id, assignedName: profiles.fullName,
    contactId: contacts.id, contactFirst: contacts.firstName, contactLast: contacts.lastName, contactPhones: contacts.phones, smsConsent: contacts.smsConsent,
  }).from(leads)
    .innerJoin(properties, eq(leads.propertyId, properties.id))
    .innerJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .leftJoin(profiles, eq(leads.assignedTo, profiles.id))
    .leftJoin(contacts, eq(leads.primaryContactId, contacts.id))
    .where(and(...where));

  const [rows, total] = await Promise.all([
    base.orderBy(order, desc(leads.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(leads)
      .innerJoin(properties, eq(leads.propertyId, properties.id)).innerJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
      .leftJoin(leadSources, eq(leads.sourceId, leadSources.id)).leftJoin(profiles, eq(leads.assignedTo, profiles.id)).leftJoin(contacts, eq(leads.primaryContactId, contacts.id))
      .where(and(...where)),
  ]);
  const ids = rows.map((r) => r.id);
  const tagRows = ids.length ? await db.select({ leadId: leadTags.leadId, name: tags.name, color: tags.color, kind: tags.kind }).from(leadTags).innerJoin(tags, eq(leadTags.tagId, tags.id)).where(inArray(leadTags.leadId, ids)) : [];
  return {
    rows: rows.map((r) => ({ ...r, tags: tagRows.filter((t) => t.leadId === r.id) })),
    total: total[0]?.n ?? 0, page, pageSize,
  };
}

export type LeadRow = Awaited<ReturnType<typeof listLeads>>["rows"][number];

/** Every open lead grouped by stage for the board. */
export async function boardLeads(orgId: string, assigned?: string) {
  const { rows } = await listLeads(orgId, { status: "open", assigned, pageSize: 500, sort: "followUp", dir: "asc" });
  return rows;
}

export async function getLead(orgId: string, id: string) {
  const db = await getDb();
  const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, id), eq(leads.orgId, orgId)) });
  if (!lead) return null;
  const [property, stage, source, assigned, primaryContact, contactLinks, tagRows, activityRows, taskRows, offerRows, messageRows, analysisRows, report, docRows, enrollments] = await Promise.all([
    db.query.properties.findFirst({ where: eq(properties.id, lead.propertyId) }),
    db.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, lead.stageId) }),
    lead.sourceId ? db.query.leadSources.findFirst({ where: eq(leadSources.id, lead.sourceId) }) : null,
    lead.assignedTo ? db.query.profiles.findFirst({ where: eq(profiles.id, lead.assignedTo) }) : null,
    lead.primaryContactId ? db.query.contacts.findFirst({ where: eq(contacts.id, lead.primaryContactId) }) : null,
    db.select({ link: propertyContacts, contact: contacts }).from(propertyContacts).innerJoin(contacts, eq(propertyContacts.contactId, contacts.id)).where(eq(propertyContacts.propertyId, lead.propertyId)),
    db.select({ id: tags.id, name: tags.name, color: tags.color, kind: tags.kind }).from(leadTags).innerJoin(tags, eq(leadTags.tagId, tags.id)).where(eq(leadTags.leadId, id)),
    db.select({ a: activities, actor: profiles.fullName }).from(activities).leftJoin(profiles, eq(activities.actorId, profiles.id)).where(eq(activities.leadId, id)).orderBy(desc(activities.occurredAt)).limit(200),
    db.select({ t: tasks, assignee: profiles.fullName }).from(tasks).leftJoin(profiles, eq(tasks.assignedTo, profiles.id)).where(eq(tasks.leadId, id)).orderBy(asc(tasks.doneAt), asc(tasks.dueAt)),
    db.select().from(offers).where(eq(offers.leadId, id)).orderBy(desc(offers.createdAt)),
    db.select().from(messages).where(eq(messages.leadId, id)).orderBy(asc(messages.createdAt)),
    db.select().from(dealAnalyses).where(eq(dealAnalyses.propertyId, lead.propertyId)).orderBy(desc(dealAnalyses.version)),
    db.query.propertyReports.findFirst({ where: eq(propertyReports.propertyId, lead.propertyId), orderBy: desc(propertyReports.fetchedAt) }),
    db.select().from(documents).where(or(eq(documents.leadId, id), eq(documents.propertyId, lead.propertyId))).orderBy(desc(documents.createdAt)),
    db.select({ e: campaignEnrollments, name: campaigns.name }).from(campaignEnrollments).innerJoin(campaigns, eq(campaignEnrollments.campaignId, campaigns.id)).where(eq(campaignEnrollments.leadId, id)),
  ]);
  return { lead, property: property!, stage: stage!, source, assigned, primaryContact, contacts: contactLinks, tags: tagRows, activities: activityRows, tasks: taskRows, offers: offerRows, messages: messageRows, analyses: analysisRows, report, documents: docRows, enrollments };
}

export type LeadDetail = NonNullable<Awaited<ReturnType<typeof getLead>>>;

export async function leadCountsByStage(orgId: string) {
  const db = await getDb();
  return db.select({ stageId: leads.stageId, n: count() }).from(leads).where(and(eq(leads.orgId, orgId), eq(leads.status, "open"))).groupBy(leads.stageId);
}

export async function propertyComps(propertyId: string) {
  const db = await getDb();
  return db.select().from(comps).where(eq(comps.propertyId, propertyId)).orderBy(asc(comps.distanceMi));
}
