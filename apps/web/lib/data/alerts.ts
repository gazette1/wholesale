import { and, count, desc, eq, isNull, or } from "drizzle-orm";
import { alerts, leads, properties } from "@dealcalc/db";
import { getDb } from "../db";

export type AlertRow = { id: string; kind: string; title: string; body: string | null; leadId: string | null; address: string | null; readAt: Date | null; dismissedAt: Date | null; createdAt: Date };

/** Who an alert reaches: its own recipient, plus org wide alerts (no recipient) sent when the lead had no assignee. */
function forRecipient(orgId: string, profileId: string) {
  return and(eq(alerts.orgId, orgId), or(eq(alerts.recipientId, profileId), isNull(alerts.recipientId)));
}

/** Newest first, capped, dismissed ones left out unless asked for. Powers the /alerts page. */
export async function listAlerts(orgId: string, profileId: string, opts: { includeDismissed?: boolean } = {}): Promise<AlertRow[]> {
  const db = await getDb();
  const where = [forRecipient(orgId, profileId)!];
  if (!opts.includeDismissed) where.push(isNull(alerts.dismissedAt));
  return db.select({ id: alerts.id, kind: alerts.kind, title: alerts.title, body: alerts.body, leadId: alerts.leadId, address: properties.addressLine1, readAt: alerts.readAt, dismissedAt: alerts.dismissedAt, createdAt: alerts.createdAt })
    .from(alerts).leftJoin(leads, eq(alerts.leadId, leads.id)).leftJoin(properties, eq(leads.propertyId, properties.id))
    .where(and(...where)).orderBy(desc(alerts.createdAt)).limit(200);
}

/** Unread, not dismissed. Powers the bell badge in the app shell. */
export async function unreadAlertCount(orgId: string, profileId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(alerts).where(and(forRecipient(orgId, profileId)!, isNull(alerts.readAt), isNull(alerts.dismissedAt)));
  return row?.n ?? 0;
}
