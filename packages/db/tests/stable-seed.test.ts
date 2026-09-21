import { describe, it, expect } from "vitest";
import { asc } from "drizzle-orm";
import { createPgliteDb } from "../src/client";
import { migrate } from "../src/migrate";
import { seedWithStableIds } from "../src/dev";
import { leads, dealAnalyses, orgs, tags } from "../src/schema";

// Same pattern as isUuid() in apps/web/lib/safe.ts, so seeded ids pass the web app's route guard.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function freshInstance() {
  const db = createPgliteDb();
  await migrate(db);
  await seedWithStableIds(db);
  return db;
}

describe("demo seed with stable ids", () => {
  it("gives two separate databases the same ids, as two serverless instances need", async () => {
    const [a, b] = await Promise.all([freshInstance(), freshInstance()]);
    const leadIds = async (db: Awaited<ReturnType<typeof freshInstance>>) => (await db.select({ id: leads.id }).from(leads).orderBy(asc(leads.id))).map((r) => r.id);
    const analysisIds = async (db: Awaited<ReturnType<typeof freshInstance>>) => (await db.select({ id: dealAnalyses.id }).from(dealAnalyses).orderBy(asc(dealAnalyses.id))).map((r) => r.id);
    const [la, lb, aa, ab] = await Promise.all([leadIds(a), leadIds(b), analysisIds(a), analysisIds(b)]);
    expect(la).toHaveLength(40);
    expect(la).toEqual(lb);
    expect(aa.length).toBeGreaterThan(0);
    expect(aa).toEqual(ab);
    for (const id of [...la, ...aa]) expect(id).toMatch(UUID);
  }, 60_000);

  it("goes back to random ids for rows created after the seed", async () => {
    const db = await freshInstance();
    const [org] = await db.select({ id: orgs.id }).from(orgs).limit(1);
    const [tag] = await db.insert(tags).values({ orgId: org!.id, name: "Created after seed" }).returning();
    expect(tag!.id).toMatch(UUID);
    expect(tag!.id.startsWith("00000000-0000-4000-8000-")).toBe(false);
  }, 60_000);
});
