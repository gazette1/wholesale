import { and, asc, desc, eq, ilike, or, count } from "drizzle-orm";
import { buyers, buyerCriteria, buyerPurchases, dealSubmissions, dealAnalyses, properties } from "@dealcalc/db";
import { getDb } from "../db";

export async function listBuyers(orgId: string, q?: string, state?: string) {
  const db = await getDb();
  const where = [eq(buyers.orgId, orgId)];
  if (q) where.push(or(ilike(buyers.company, `%${q}%`), ilike(buyers.firstName, `%${q}%`), ilike(buyers.lastName, `%${q}%`))!);
  const rows = await db.select({ buyer: buyers, criteria: buyerCriteria }).from(buyers).leftJoin(buyerCriteria, eq(buyerCriteria.buyerId, buyers.id)).where(and(...where)).orderBy(desc(buyers.active), asc(buyers.company));
  const subs = await db.select({ buyerId: dealSubmissions.buyerId, n: count() }).from(dealSubmissions).where(eq(dealSubmissions.orgId, orgId)).groupBy(dealSubmissions.buyerId);
  return rows
    .filter((r) => !state || (r.criteria?.states ?? []).includes(state))
    .map((r) => ({ ...r, submissions: subs.find((s) => s.buyerId === r.buyer.id)?.n ?? 0 }));
}

export async function getBuyer(orgId: string, id: string) {
  const db = await getDb();
  const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, id), eq(buyers.orgId, orgId)) });
  if (!buyer) return null;
  const [criteria, purchases, submissions] = await Promise.all([
    db.query.buyerCriteria.findFirst({ where: eq(buyerCriteria.buyerId, id) }),
    db.select().from(buyerPurchases).where(eq(buyerPurchases.buyerId, id)).orderBy(desc(buyerPurchases.closedAt)),
    db.select({ s: dealSubmissions, address: properties.addressLine1, city: properties.city, analysisId: dealAnalyses.id, spread: dealAnalyses.spread, price: dealAnalyses.purchasePrice })
      .from(dealSubmissions).innerJoin(dealAnalyses, eq(dealSubmissions.analysisId, dealAnalyses.id)).innerJoin(properties, eq(dealAnalyses.propertyId, properties.id))
      .where(eq(dealSubmissions.buyerId, id)).orderBy(desc(dealSubmissions.createdAt)),
  ]);
  return { buyer, criteria, purchases, submissions };
}
