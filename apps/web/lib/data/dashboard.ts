import { lt, and, count, countDistinct, eq, gte, isNotNull, isNull, lte, sql, desc } from "drizzle-orm";
import { leads, pipelineStages, leadSources, tasks, offers, activities, profiles, properties, contacts } from "@dealcalc/db";
import { getDb } from "../db";
import { appDayBounds } from "../utils";

export async function dashboardData(orgId: string) {
  const db = await getDb();
  const now = new Date();
  const day = appDayBounds(now);
  const endOfToday = day.end;
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [stages, byStage, bySource, followUpsDue, overdue, offersSent, contracts, closed, newThisWeek, untouched, recent, teamActivity] = await Promise.all([
    db.select().from(pipelineStages).where(eq(pipelineStages.orgId, orgId)).orderBy(pipelineStages.position),
    // Counted by stage, whatever the status, so the Closed and Dead chips match what is in those stages.
    db.select({ stageId: leads.stageId, n: count() }).from(leads).where(eq(leads.orgId, orgId)).groupBy(leads.stageId),
    db.select({ source: leadSources.name, n: count() }).from(leads).leftJoin(leadSources, eq(leads.sourceId, leadSources.id)).where(eq(leads.orgId, orgId)).groupBy(leadSources.name),
    db.select({ n: count() }).from(leads).where(and(eq(leads.orgId, orgId), eq(leads.status, "open"), isNotNull(leads.nextFollowUpAt), lte(leads.nextFollowUpAt, endOfToday))),
    db.select({ n: count() }).from(leads).where(and(eq(leads.orgId, orgId), eq(leads.status, "open"), isNotNull(leads.nextFollowUpAt), lt(leads.nextFollowUpAt, day.start))),
    // Counts leads, not offer rows, so the tile matches the list behind it (/leads?offer=sent&status=all).
    db.select({ n: countDistinct(offers.leadId) }).from(offers).where(and(eq(offers.orgId, orgId), eq(offers.status, "sent"))),
    db.select({ n: count() }).from(leads).innerJoin(pipelineStages, eq(leads.stageId, pipelineStages.id)).where(and(eq(leads.orgId, orgId), sql`${pipelineStages.key} in ('under_contract','due_diligence')`)),
    db.select({ n: count() }).from(leads).where(and(eq(leads.orgId, orgId), eq(leads.status, "won"))),
    db.select({ n: count() }).from(leads).where(and(eq(leads.orgId, orgId), gte(leads.createdAt, weekAgo))),
    db.select({ n: count() }).from(leads).where(and(eq(leads.orgId, orgId), eq(leads.status, "open"), eq(leads.contactAttempts, 0))),
    db.select({ id: leads.id, createdAt: leads.createdAt, stageId: leads.stageId, contactAttempts: leads.contactAttempts, address: properties.addressLine1, city: properties.city, first: contacts.firstName, last: contacts.lastName, assigned: profiles.fullName })
      .from(leads).innerJoin(properties, eq(leads.propertyId, properties.id)).leftJoin(contacts, eq(leads.primaryContactId, contacts.id)).leftJoin(profiles, eq(leads.assignedTo, profiles.id))
      .where(and(eq(leads.orgId, orgId), eq(leads.status, "open"))).orderBy(desc(leads.createdAt)).limit(8),
    db.select({ actor: profiles.fullName, n: count() }).from(activities).leftJoin(profiles, eq(activities.actorId, profiles.id)).where(and(eq(activities.orgId, orgId), gte(activities.occurredAt, weekAgo), sql`${activities.type} in ('call','sms','email')`)).groupBy(profiles.fullName),
  ]);

  const speed = await db.select({ avg: sql<number>`avg(${leads.firstResponseMinutes})` }).from(leads).where(and(eq(leads.orgId, orgId), isNotNull(leads.firstResponseMinutes), gte(leads.createdAt, new Date(now.getTime() - 30 * 86_400_000))));

  const stageCounts = stages.map((s) => ({ ...s, n: byStage.find((b) => b.stageId === s.id)?.n ?? 0 }));
  return {
    stages: stageCounts,
    bySource: bySource.map((s) => ({ source: s.source ?? "Unknown", n: s.n })).sort((a, b) => b.n - a.n),
    followUpsDue: followUpsDue[0]?.n ?? 0,
    overdue: overdue[0]?.n ?? 0,
    offersSent: offersSent[0]?.n ?? 0,
    contracts: contracts[0]?.n ?? 0,
    closed: closed[0]?.n ?? 0,
    newThisWeek: newThisWeek[0]?.n ?? 0,
    untouched: untouched[0]?.n ?? 0,
    avgFirstResponseMinutes: speed[0]?.avg ? Number(speed[0].avg) : null,
    recent: recent.map((r) => ({ ...r, stage: stageCounts.find((s) => s.id === r.stageId) })),
    teamActivity: teamActivity.map((t) => ({ actor: t.actor ?? "Unassigned", n: t.n })).sort((a, b) => b.n - a.n),
    openLeads: stageCounts.filter((s) => !s.isTerminal).reduce((a, s) => a + s.n, 0),
  };
}

export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;

export async function myTasksDue(orgId: string, profileId: string) {
  const db = await getDb();
  const endOfToday = appDayBounds().end;
  return db.select({ id: tasks.id, title: tasks.title, kind: tasks.kind, dueAt: tasks.dueAt, leadId: tasks.leadId, address: properties.addressLine1, city: properties.city })
    .from(tasks).leftJoin(leads, eq(tasks.leadId, leads.id)).leftJoin(properties, eq(leads.propertyId, properties.id))
    .where(and(eq(tasks.orgId, orgId), eq(tasks.assignedTo, profileId), isNull(tasks.doneAt), lte(tasks.dueAt, endOfToday)))
    .orderBy(tasks.dueAt).limit(10);
}
