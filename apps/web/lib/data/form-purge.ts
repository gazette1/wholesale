import { and, asc, desc, eq, isNull, or, isNotNull } from "drizzle-orm";
import { formPurgeRequests, formExternalParties, buyers, contacts, profiles } from "@dealcalc/db";
import { getDb } from "../db";

export type PurgeRequestRow = {
  id: string;
  targetType: string;
  targetLabel: string;
  requestReference: string;
  status: "pending" | "executed" | "cancelled";
  requestedBy: string;
  requestedByName: string;
  approvedByName: string | null;
  createdAt: string;
  executedAt: string | null;
  summary: Record<string, number>;
};

export type PurgeTarget = { type: "external_party" | "buyer" | "contact"; id: string; label: string };

/** Purge requests for the org, newest first. Org scoped. */
export async function listPurgeRequests(orgId: string): Promise<PurgeRequestRow[]> {
  const db = await getDb();
  const rows = await db.select().from(formPurgeRequests).where(eq(formPurgeRequests.orgId, orgId)).orderBy(desc(formPurgeRequests.createdAt)).limit(100);
  const team = await db.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(eq(profiles.orgId, orgId));
  const name = new Map(team.map((p) => [p.id, p.name]));
  const targets = new Map((await listPurgeTargets(orgId)).map((t) => [t.id, t.label]));
  return rows.map((r) => ({
    id: r.id, targetType: r.targetType, targetLabel: targets.get(r.targetId) ?? (r.status === "executed" ? "Removed" : "Unknown"),
    requestReference: r.requestReference, status: r.status, requestedBy: r.requestedBy, requestedByName: name.get(r.requestedBy) ?? "Team member",
    approvedByName: r.approvedBy ? (name.get(r.approvedBy) ?? "Team member") : null,
    createdAt: r.createdAt.toISOString(), executedAt: r.executedAt?.toISOString() ?? null, summary: r.summary ?? {},
  }));
}

/** People whose form data can be purged: outside parties with an email or phone, buyers, and contacts. */
export async function listPurgeTargets(orgId: string): Promise<PurgeTarget[]> {
  const db = await getDb();
  const [parties, buyerRows, contactRows] = await Promise.all([
    db.select({ id: formExternalParties.id, email: formExternalParties.email, phone: formExternalParties.phone, name: formExternalParties.name }).from(formExternalParties)
      .where(and(eq(formExternalParties.orgId, orgId), isNull(formExternalParties.archivedAt), or(isNotNull(formExternalParties.email), isNotNull(formExternalParties.phone))))
      .orderBy(asc(formExternalParties.createdAt)).limit(500),
    db.select({ id: buyers.id, first: buyers.firstName, last: buyers.lastName, company: buyers.company }).from(buyers).where(eq(buyers.orgId, orgId)).orderBy(asc(buyers.firstName)).limit(500),
    db.select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName }).from(contacts).where(eq(contacts.orgId, orgId)).orderBy(asc(contacts.firstName)).limit(500),
  ]);
  return [
    ...parties.map((p) => ({ type: "external_party" as const, id: p.id, label: `Outside person: ${[p.name, p.email ?? p.phone].filter(Boolean).join(", ")}` })),
    ...buyerRows.map((b) => ({ type: "buyer" as const, id: b.id, label: `Buyer: ${[b.first, b.last].filter(Boolean).join(" ") || b.company || "Unnamed"}` })),
    ...contactRows.map((c) => ({ type: "contact" as const, id: c.id, label: `Contact: ${[c.first, c.last].filter(Boolean).join(" ")}` })),
  ];
}
