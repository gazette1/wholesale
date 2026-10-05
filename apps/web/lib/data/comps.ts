import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { properties, comps, leads, dealAnalyses } from "@dealcalc/db";
import type { CompInput, CompsSubject, ManualAdjustment } from "@dealcalc/engine";
import { getDb } from "../db";
import { isUuid } from "../safe";

const toNum = (v: string | null) => (v === null ? null : Number(v));

/** The adjustments column is a free form label to dollars map, so anything that is not a finite number is dropped. */
export function manualAdjustments(raw: Record<string, number> | null | undefined): ManualAdjustment[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).filter(([label, amount]) => label.trim() !== "" && Number.isFinite(Number(amount))).map(([label, amount]) => ({ label: label.slice(0, 80), amount: Number(amount) }));
}

/** A comps row in the shape the engine takes. */
export function toCompInput(row: typeof comps.$inferSelect): CompInput {
  return {
    id: row.id, label: row.address, price: Number(row.soldPrice ?? 0), soldOn: row.soldAt ? row.soldAt.toISOString() : null,
    sqft: row.sqft, beds: toNum(row.beds), baths: toNum(row.baths), yearBuilt: row.yearBuilt, lotSqft: null,
    distanceMi: toNum(row.distanceMi), included: row.included, manual: manualAdjustments(row.adjustments),
  };
}

/**
 * Everything the comps workspace needs for one property: the subject, its comps, the lead it belongs to,
 * and the primary analysis the ARV can be written into. Every query is scoped to the caller's org.
 */
export async function compsWorkspace(orgId: string, propertyId: string) {
  if (!isUuid(propertyId)) return null;
  const db = await getDb();
  const property = await db.query.properties.findFirst({ where: and(eq(properties.id, propertyId), eq(properties.orgId, orgId)) });
  if (!property) return null;
  const [rows, lead, primary] = await Promise.all([
    db.select().from(comps).where(and(eq(comps.propertyId, propertyId), eq(comps.orgId, orgId))).orderBy(asc(comps.distanceMi), desc(comps.soldAt)),
    db.query.leads.findFirst({ where: and(eq(leads.propertyId, propertyId), eq(leads.orgId, orgId)), orderBy: desc(leads.createdAt) }),
    db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.propertyId, propertyId), eq(dealAnalyses.orgId, orgId), eq(dealAnalyses.isPrimary, true), isNull(dealAnalyses.trashedAt)), orderBy: desc(dealAnalyses.version) }),
  ]);
  const subject: CompsSubject = { sqft: property.sqft, beds: toNum(property.beds), baths: toNum(property.baths), yearBuilt: property.yearBuilt, lotSqft: property.lotSqft };
  return {
    property, lead: lead ?? null, subject,
    rows: rows.map((r) => ({ row: r, input: toCompInput(r) })),
    analysis: primary ? { id: primary.id, version: primary.version, name: primary.name, status: primary.status, locked: primary.status !== "draft" && primary.status !== "reviewing" } : null,
  };
}

export type CompsWorkspace = NonNullable<Awaited<ReturnType<typeof compsWorkspace>>>;
