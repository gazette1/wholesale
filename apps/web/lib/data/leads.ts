import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, count } from "drizzle-orm";
import {
  leads, properties, contacts, pipelineStages, leadSources, profiles, tags, leadTags, activities, tasks, offers, messages,
  dealAnalyses, propertyReports, propertyContacts, documents, comps, campaignEnrollments, campaigns,
} from "@dealcalc/db";
import { getDb } from "../db";

export type LeadFilters = {
  q?: string; stage?: string; assigned?: string; source?: string; status?: string; tag?: string; due?: "today" | "overdue" | "week";
  sort?: string; dir?: "asc" | "desc"; page?: number; pageSize?: number; issue?: string;
  /** "1" keeps only leads with zero contact attempts. */
  untouched?: string;
  /** Leads created today, in the last 7 days, or in the last 30 days. */
  created?: "today" | "week" | "month";
  /** "sent" keeps only leads that have an offer awaiting a seller response. */
  offer?: string;
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
  if (f.stage) {
    // One key, or several separated by commas (the dashboard links to under_contract,due_diligence).
    const keys = f.stage.split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length === 1) where.push(eq(pipelineStages.key, keys[0]!));
    else if (keys.length > 1) where.push(inArray(pipelineStages.key, keys));
  }
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
  if (f.untouched === "1") where.push(eq(leads.contactAttempts, 0));
  if (f.created === "today") { const start = new Date(now); start.setHours(0, 0, 0, 0); where.push(gte(leads.createdAt, start)); }
  if (f.created === "week") where.push(gte(leads.createdAt, new Date(now.getTime() - 7 * 86_400_000)));
  if (f.created === "month") where.push(gte(leads.createdAt, new Date(now.getTime() - 30 * 86_400_000)));
  if (f.offer === "sent") where.push(inArray(leads.id, db.select({ id: offers.leadId }).from(offers).where(and(eq(offers.orgId, orgId), eq(offers.status, "sent")))));
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

type AnalysisPick = { id: string; propertyId: string; version: number; name: string; status: string; isPrimary: boolean; arv: string | null; purchasePrice: string | null; maxAllowableOffer: string | null; spread: string | null; netProfit: string | null; updatedAt: Date };

/**
 * The analysis that speaks for each property: the primary one, else the latest version.
 * Trashed analyses are ignored. One query for the whole set of properties.
 */
export async function primaryAnalysesByProperty(orgId: string, propertyIds: string[]) {
  const picked = new Map<string, AnalysisPick>();
  const counts = new Map<string, number>();
  const ids = [...new Set(propertyIds)];
  if (!ids.length) return { picked, counts };
  const db = await getDb();
  const rows = await db.select({
    id: dealAnalyses.id, propertyId: dealAnalyses.propertyId, version: dealAnalyses.version, name: dealAnalyses.name, status: dealAnalyses.status, isPrimary: dealAnalyses.isPrimary,
    arv: dealAnalyses.arv, purchasePrice: dealAnalyses.purchasePrice, maxAllowableOffer: dealAnalyses.maxAllowableOffer, spread: dealAnalyses.spread, netProfit: dealAnalyses.netProfit, updatedAt: dealAnalyses.updatedAt,
  }).from(dealAnalyses)
    .where(and(eq(dealAnalyses.orgId, orgId), inArray(dealAnalyses.propertyId, ids), isNull(dealAnalyses.trashedAt)))
    .orderBy(desc(dealAnalyses.isPrimary), desc(dealAnalyses.version));
  for (const r of rows) {
    counts.set(r.propertyId, (counts.get(r.propertyId) ?? 0) + 1);
    if (!picked.has(r.propertyId)) picked.set(r.propertyId, r);
  }
  return { picked, counts };
}

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Every open lead grouped by stage for the board, with the deal numbers of its primary analysis. */
export async function boardLeads(orgId: string, assigned?: string) {
  const { rows } = await listLeads(orgId, { status: "open", assigned, pageSize: 500, sort: "followUp", dir: "asc" });
  const { picked } = await primaryAnalysesByProperty(orgId, rows.map((r) => r.propertyId));
  return rows.map((r) => {
    const a = picked.get(r.propertyId);
    return { ...r, analysisId: a?.id ?? null, analysisMao: toNum(a?.maxAllowableOffer), analysisSpread: toNum(a?.spread) };
  });
}

function activityText(type: string, p: Record<string, any>): string {
  switch (type) {
    case "stage_change": return `Moved to ${String(p.toName ?? p.to ?? "another stage").replace(/_/g, " ")}`;
    case "offer": return p.status ? `Offer ${p.status}${p.amount ? ` $${Math.round(Number(p.amount)).toLocaleString("en-US")}` : ""}` : "Offer";
    case "enrichment": return `Property report ${p.status ?? ""}${p.provider ? ` (${p.provider})` : ""}`.trim();
    default: return String(p.text ?? p.body ?? "");
  }
}

/** Everything the pipeline quick view drawer shows for one lead, as a plain serializable object. */
export async function leadQuickView(orgId: string, leadId: string) {
  const db = await getDb();
  const [row] = await db.select({
    id: leads.id, status: leads.status, propertyId: leads.propertyId, nextFollowUpAt: leads.nextFollowUpAt, lastContactAt: leads.lastContactAt, contactAttempts: leads.contactAttempts,
    motivationScore: leads.motivationScore, sellerUrgency: leads.sellerUrgency, askingPrice: leads.askingPrice, dealIssues: leads.dealIssues,
    address: properties.addressLine1, city: properties.city, state: properties.state, postalCode: properties.postalCode,
    stageId: pipelineStages.id, stageName: pipelineStages.name, stageColor: pipelineStages.color,
    source: leadSources.name, assignedName: profiles.fullName,
    contactId: contacts.id, contactFirst: contacts.firstName, contactLast: contacts.lastName, contactPhones: contacts.phones, contactEmails: contacts.emails, smsConsent: contacts.smsConsent, doNotContact: contacts.doNotContact,
  }).from(leads)
    .innerJoin(properties, eq(leads.propertyId, properties.id))
    .innerJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .leftJoin(profiles, eq(leads.assignedTo, profiles.id))
    .leftJoin(contacts, eq(leads.primaryContactId, contacts.id))
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId))).limit(1);
  if (!row) return null;

  const [tagRows, activityRows, analyses] = await Promise.all([
    db.select({ name: tags.name, color: tags.color, kind: tags.kind }).from(leadTags).innerJoin(tags, eq(leadTags.tagId, tags.id)).where(and(eq(leadTags.leadId, leadId), eq(tags.orgId, orgId))),
    db.select({ id: activities.id, type: activities.type, payload: activities.payload, occurredAt: activities.occurredAt, actor: profiles.fullName })
      .from(activities).leftJoin(profiles, eq(activities.actorId, profiles.id))
      .where(and(eq(activities.leadId, leadId), eq(activities.orgId, orgId))).orderBy(desc(activities.occurredAt)).limit(5),
    primaryAnalysesByProperty(orgId, [row.propertyId]),
  ]);

  const phones = (row.contactPhones ?? []) as { number: string; isPrimary?: boolean }[];
  const emails = (row.contactEmails ?? []) as { address: string; isPrimary?: boolean }[];
  const issues = (row.dealIssues ?? {}) as Record<string, any>;
  const a = analyses.picked.get(row.propertyId);
  const arv = toNum(a?.arv);
  const offer = toNum(a?.purchasePrice);
  return {
    id: row.id, status: row.status as string, propertyId: row.propertyId,
    address: row.address, city: row.city, state: row.state, postalCode: row.postalCode,
    stageId: row.stageId, stageName: row.stageName, stageColor: row.stageColor,
    source: row.source, assignedName: row.assignedName, urgency: row.sellerUrgency as string, motivationScore: row.motivationScore,
    messyScore: Number(issues.messyScore ?? 0),
    issues: Object.entries(issues).filter(([k, v]) => k !== "messyScore" && v && typeof v === "object" && (v as any).flagged).map(([k]) => k),
    tags: tagRows.map((t) => ({ name: t.name, color: t.color, kind: t.kind as string })),
    contact: row.contactId ? {
      id: row.contactId, name: [row.contactFirst, row.contactLast].filter(Boolean).join(" "),
      phone: (phones.find((p) => p.isPrimary) ?? phones[0])?.number ?? null,
      email: (emails.find((e) => e.isPrimary) ?? emails[0])?.address ?? null,
      smsConsent: (row.smsConsent ?? "unknown") as string, doNotContact: Boolean(row.doNotContact),
    } : null,
    nextFollowUpAt: row.nextFollowUpAt ? row.nextFollowUpAt.toISOString() : null,
    lastContactAt: row.lastContactAt ? row.lastContactAt.toISOString() : null,
    contactAttempts: row.contactAttempts, askingPrice: toNum(row.askingPrice),
    analysis: a ? {
      id: a.id, version: a.version, name: a.name, status: a.status, isPrimary: a.isPrimary,
      arv, purchasePrice: offer, maxAllowableOffer: toNum(a.maxAllowableOffer), spread: toNum(a.spread), netProfit: toNum(a.netProfit),
      offerPctOfArv: arv && offer != null ? offer / arv : null, updatedAt: a.updatedAt.toISOString(),
    } : null,
    analysisCount: analyses.counts.get(row.propertyId) ?? 0,
    activities: activityRows.map((r) => ({ id: r.id, type: r.type as string, text: activityText(r.type, (r.payload ?? {}) as Record<string, any>), actor: r.actor, occurredAt: r.occurredAt.toISOString() })),
  };
}

export type LeadQuickView = NonNullable<Awaited<ReturnType<typeof leadQuickView>>>;

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
    db.select().from(dealAnalyses).where(and(eq(dealAnalyses.propertyId, lead.propertyId), eq(dealAnalyses.orgId, orgId), isNull(dealAnalyses.trashedAt))).orderBy(desc(dealAnalyses.version)),
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
