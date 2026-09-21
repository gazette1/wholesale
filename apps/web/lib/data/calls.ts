import { and, desc, eq } from "drizzle-orm";
import { calls, profiles } from "@dealcalc/db";
import { getDb } from "../db";

/** Newest first. Capped, because the Calls tab is a log, not a report. */
export async function listLeadCalls(orgId: string, leadId: string) {
  const db = await getDb();
  return db.select({ call: calls, placedByName: profiles.fullName }).from(calls).leftJoin(profiles, eq(profiles.id, calls.placedBy)).where(and(eq(calls.orgId, orgId), eq(calls.leadId, leadId))).orderBy(desc(calls.createdAt)).limit(200);
}

export type LeadCall = Awaited<ReturnType<typeof listLeadCalls>>[number];
