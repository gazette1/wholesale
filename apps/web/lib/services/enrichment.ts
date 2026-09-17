import { eq, and } from "drizzle-orm";
import { properties, propertyReports, comps, activities, leads } from "@dealcalc/db";
import { propertyDataProvider } from "@dealcalc/integrations";
import { getDb } from "../db";

/** Fetch a property report and comps from the configured provider and store both. */
export async function enrichProperty(orgId: string, propertyId: string, actorId: string | null) {
  const db = await getDb();
  const property = await db.query.properties.findFirst({ where: and(eq(properties.id, propertyId), eq(properties.orgId, orgId)) });
  if (!property) throw new Error("Property not found.");
  const provider = propertyDataProvider();
  const query = { addressLine1: property.addressLine1, city: property.city, state: property.state, postalCode: property.postalCode, apn: property.apn };
  const result = await provider.lookup(query);
  const [report] = await db.insert(propertyReports).values({
    orgId, propertyId, provider: result.provider, status: result.status, normalized: result.normalized, raw: result.raw, costCents: result.costCents, error: result.error ?? null,
  }).returning();

  let compCount = 0;
  if (result.status !== "failed") {
    try {
      const c = await provider.comps({ ...query, sqft: property.sqft, beds: property.beds ? Number(property.beds) : null });
      if (c.comps.length) {
        await db.delete(comps).where(and(eq(comps.propertyId, propertyId), eq(comps.source, "provider")));
        await db.insert(comps).values(c.comps.map((x) => ({
          orgId, propertyId, reportId: report!.id, source: "provider" as const, address: x.address,
          soldPrice: x.soldPrice != null ? String(x.soldPrice) : null, soldAt: x.soldAt ? new Date(x.soldAt) : null, sqft: x.sqft ?? null,
          beds: x.beds != null ? String(x.beds) : null, baths: x.baths != null ? String(x.baths) : null, yearBuilt: x.yearBuilt ?? null,
          distanceMi: x.distanceMi != null ? String(x.distanceMi) : null, included: true,
        })));
        compCount = c.comps.length;
      }
    } catch {
      // comps are optional; the report still stands
    }
    // Fill blanks on the property from the report, never overwrite typed values.
    const ch = result.normalized.characteristics;
    const patch: Partial<typeof properties.$inferInsert> = {};
    if (!property.beds && ch.beds != null) patch.beds = String(ch.beds);
    if (!property.baths && ch.baths != null) patch.baths = String(ch.baths);
    if (!property.sqft && ch.sqft != null) patch.sqft = ch.sqft;
    if (!property.lotSqft && ch.lotSqft != null) patch.lotSqft = ch.lotSqft;
    if (!property.yearBuilt && ch.yearBuilt != null) patch.yearBuilt = ch.yearBuilt;
    if (!property.propertyType && ch.propertyType) patch.propertyType = ch.propertyType;
    if (!property.lat && result.normalized.location.lat != null) patch.lat = String(result.normalized.location.lat);
    if (!property.lng && result.normalized.location.lng != null) patch.lng = String(result.normalized.location.lng);
    if (!property.county && result.normalized.location.county) patch.county = result.normalized.location.county;
    if (Object.keys(patch).length) await db.update(properties).set(patch).where(eq(properties.id, propertyId));
  }

  const lead = await db.query.leads.findFirst({ where: eq(leads.propertyId, propertyId) });
  await db.insert(activities).values({ orgId, leadId: lead?.id ?? null, propertyId, actorId, type: "enrichment", payload: { provider: result.provider, status: result.status, compCount, error: result.error } });
  return { report: report!, compCount };
}
