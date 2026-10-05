import { and, eq, isNull, lt, lte, like } from "drizzle-orm";
import { leads, offers, alerts, properties } from "@dealcalc/db";
import { getDb } from "../db";
import { dayKey } from "../utils";
import { emitEvent } from "./integrations";

/**
 * Alert thresholds. Named here, in one place, and nowhere else.
 * Rule 1: an open lead with zero contact attempts, this long after it was created.
 * Rule 3: a sent offer whose expiresAt falls within this many hours.
 */
export const UNTOUCHED_LEAD_MINUTES = 15;
export const OFFER_EXPIRING_HOURS = 24;

type Db = Awaited<ReturnType<typeof getDb>>;

/** Insert one alert. The unique (org_id, dedupe_key) index silently absorbs a repeat cron run; never throws on a conflict. */
async function raise(db: Db, row: typeof alerts.$inferInsert): Promise<boolean> {
  const [inserted] = await db.insert(alerts).values(row).onConflictDoNothing().returning();
  return Boolean(inserted);
}

export type AlertsRunResult = { created: number; details: string[] };

/**
 * Raise alerts for every org (the cron path), or one org when given. Three rules, each deduplicated by
 * dedupeKey so a repeat run cannot create the same alert twice:
 * 1. An open lead with zero contact attempts, UNTOUCHED_LEAD_MINUTES after creation.
 * 2. An open lead whose next follow up is overdue.
 * 3. A sent offer whose expiresAt is within OFFER_EXPIRING_HOURS.
 * Called from the cron dispatch route. Never throws; a failed rule does not stop the others.
 */
export async function raiseAlerts(orgId?: string): Promise<AlertsRunResult> {
  const db = await getDb();
  const now = new Date();
  let created = 0;
  const details: string[] = [];

  try {
    const untouchedCutoff = new Date(now.getTime() - UNTOUCHED_LEAD_MINUTES * 60_000);
    const where = [eq(leads.status, "open"), eq(leads.contactAttempts, 0), lte(leads.createdAt, untouchedCutoff)];
    if (orgId) where.push(eq(leads.orgId, orgId));
    const rows = await db.select({ id: leads.id, orgId: leads.orgId, assignedTo: leads.assignedTo, address: properties.addressLine1 })
      .from(leads).innerJoin(properties, eq(leads.propertyId, properties.id)).where(and(...where)).limit(500);
    for (const l of rows) {
      const ok = await raise(db, { orgId: l.orgId, leadId: l.id, recipientId: l.assignedTo, kind: "lead_untouched", title: "Lead has not been contacted", body: `${l.address} has had no contact attempts since it was created.`, dedupeKey: `lead_untouched:${l.id}` });
      if (ok) { created += 1; void emitEvent(l.orgId, "alert.created", { alertKind: "lead_untouched", leadId: l.id }); }
    }
    if (rows.length) details.push(`${rows.length} lead${rows.length === 1 ? "" : "s"} checked for no contact`);
  } catch (err) {
    details.push(`Untouched lead check failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  try {
    const where = [eq(leads.status, "open"), lt(leads.nextFollowUpAt, now)];
    if (orgId) where.push(eq(leads.orgId, orgId));
    const rows = await db.select({ id: leads.id, orgId: leads.orgId, assignedTo: leads.assignedTo, address: properties.addressLine1, nextFollowUpAt: leads.nextFollowUpAt })
      .from(leads).innerJoin(properties, eq(leads.propertyId, properties.id)).where(and(...where)).limit(500);
    for (const l of rows) {
      const ok = await raise(db, { orgId: l.orgId, leadId: l.id, recipientId: l.assignedTo, kind: "follow_up_overdue", title: "Follow up is overdue", body: `${l.address} was due ${l.nextFollowUpAt!.toLocaleString("en-US")}.`, dedupeKey: `follow_up_overdue:${l.id}:${dayKey(l.nextFollowUpAt!)}` });
      if (ok) { created += 1; void emitEvent(l.orgId, "alert.created", { alertKind: "follow_up_overdue", leadId: l.id }); }
    }
    if (rows.length) details.push(`${rows.length} overdue follow up${rows.length === 1 ? "" : "s"} checked`);
  } catch (err) {
    details.push(`Overdue follow up check failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  try {
    const expiringCutoff = new Date(now.getTime() + OFFER_EXPIRING_HOURS * 3_600_000);
    const where = [eq(offers.status, "sent"), lte(offers.expiresAt, expiringCutoff)];
    if (orgId) where.push(eq(offers.orgId, orgId));
    const rows = await db.select({ id: offers.id, orgId: offers.orgId, leadId: offers.leadId, createdBy: offers.createdBy, assignedTo: leads.assignedTo, expiresAt: offers.expiresAt, address: properties.addressLine1 })
      .from(offers).innerJoin(leads, eq(offers.leadId, leads.id)).innerJoin(properties, eq(leads.propertyId, properties.id))
      .where(and(...where)).limit(500);
    for (const o of rows) {
      if (!o.expiresAt) continue;
      const ok = await raise(db, { orgId: o.orgId, leadId: o.leadId, recipientId: o.createdBy ?? o.assignedTo, kind: "offer_expiring", title: "Offer is expiring soon", body: `The offer on ${o.address} expires ${o.expiresAt.toLocaleString("en-US")}.`, dedupeKey: `offer_expiring:${o.id}:${dayKey(o.expiresAt)}` });
      if (ok) { created += 1; void emitEvent(o.orgId, "alert.created", { alertKind: "offer_expiring", leadId: o.leadId, offerId: o.id }); }
    }
    if (rows.length) details.push(`${rows.length} expiring offer${rows.length === 1 ? "" : "s"} checked`);
  } catch (err) {
    details.push(`Expiring offer check failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  if (created) details.unshift(`${created} alert${created === 1 ? "" : "s"} raised`);
  return { created, details };
}

/**
 * Call once an offer's status becomes accepted. Stamps acceptedAt (only if it is not already set) and
 * dismisses this offer's expiring alerts. Other offers on the lead keep their alerts.
 */
export async function markOfferAccepted(orgId: string, offerId: string): Promise<void> {
  const db = await getDb();
  const offer = await db.query.offers.findFirst({ where: and(eq(offers.id, offerId), eq(offers.orgId, orgId)) });
  if (!offer) return;
  if (!offer.acceptedAt) await db.update(offers).set({ acceptedAt: new Date() }).where(and(eq(offers.id, offerId), eq(offers.orgId, orgId)));
  await db.update(alerts).set({ dismissedAt: new Date() }).where(and(eq(alerts.orgId, orgId), eq(alerts.leadId, offer.leadId), eq(alerts.kind, "offer_expiring"), like(alerts.dedupeKey, `offer_expiring:${offer.id}:%`), isNull(alerts.dismissedAt)));
}
