import { auditLog } from "@dealcalc/db";
import { getDb } from "./db";
import type { Session } from "./auth";

/** Write one audit row. Called by server actions for stage changes, offers, status changes, consent, roles, deletes. */
export async function audit(session: Session, entry: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown }) {
  const db = await getDb();
  await db.insert(auditLog).values({
    orgId: session.orgId, actorId: session.profileId, entityType: entry.entityType, entityId: entry.entityId, action: entry.action,
    before: (entry.before ?? null) as never, after: (entry.after ?? null) as never,
  });
}
