import { and, asc, desc, eq, ilike, or, count, sql } from "drizzle-orm";
import { buyers, buyerCriteria, buyerPurchases, dealSubmissions, dealAnalyses, properties } from "@dealcalc/db";
import { getDb } from "../db";
import { isUuid } from "../safe";

export async function listBuyers(orgId: string, q?: string, state?: string) {
  const db = await getDb();
  const where = [eq(buyers.orgId, orgId)];
  const term = q?.trim().slice(0, 80);
  if (term) {
    // Escape LIKE wildcards, and match "First Last" typed as one string.
    const like = `%${term.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    where.push(or(ilike(buyers.company, like), ilike(buyers.firstName, like), ilike(buyers.lastName, like), sql`(${buyers.firstName} || ' ' || coalesce(${buyers.lastName}, '')) ilike ${like}`)!);
  }
  const wantState = state?.trim().toUpperCase();
  const rows = await db.select({ buyer: buyers, criteria: buyerCriteria }).from(buyers).leftJoin(buyerCriteria, eq(buyerCriteria.buyerId, buyers.id)).where(and(...where)).orderBy(desc(buyers.active), asc(buyers.company));
  const subs = await db.select({ buyerId: dealSubmissions.buyerId, n: count() }).from(dealSubmissions).where(eq(dealSubmissions.orgId, orgId)).groupBy(dealSubmissions.buyerId);
  return rows
    .filter((r) => !wantState || (r.criteria?.states ?? []).map((x) => x.toUpperCase()).includes(wantState))
    .map((r) => ({ ...r, submissions: subs.find((s) => s.buyerId === r.buyer.id)?.n ?? 0 }));
}

export async function getBuyer(orgId: string, id: string) {
  if (!isUuid(id)) return null;
  const db = await getDb();
  const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, id), eq(buyers.orgId, orgId)) });
  if (!buyer) return null;
  const [criteria, purchases, submissions] = await Promise.all([
    db.query.buyerCriteria.findFirst({ where: eq(buyerCriteria.buyerId, id) }),
    db.select().from(buyerPurchases).where(eq(buyerPurchases.buyerId, id)).orderBy(desc(buyerPurchases.closedAt)),
    // price is what this buyer was quoted (the investor buy price), never our contract price.
    db.select({ s: dealSubmissions, address: properties.addressLine1, city: properties.city, analysisId: dealAnalyses.id, price: sql<string | null>`(${dealAnalyses.outputs} -> 'wholesale' ->> 'investorBuyPrice')` })
      .from(dealSubmissions).innerJoin(dealAnalyses, eq(dealSubmissions.analysisId, dealAnalyses.id)).innerJoin(properties, eq(dealAnalyses.propertyId, properties.id))
      .where(eq(dealSubmissions.buyerId, id)).orderBy(desc(dealSubmissions.createdAt)),
  ]);
  return { buyer, criteria, purchases, submissions };
}
