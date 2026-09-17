import { describe, it, expect, beforeAll } from "vitest";
import { count, eq } from "drizzle-orm";
import { createPgliteDb } from "../src/client";
import { migrate } from "../src/migrate";
import { seed } from "../src/seed";
import { leads, buyers, dealAnalyses, pipelineStages, messages, tasks, propertyReports } from "../src/schema";

const db = createPgliteDb();

describe("seed on PGlite", () => {
  let result: Awaited<ReturnType<typeof seed>>;
  beforeAll(async () => {
    await migrate(db);
    result = await seed(db, { seed: 7 });
  });

  it("creates the demo data set", async () => {
    expect(result.leadIds.length).toBe(40);
    expect(result.buyerIds.length).toBe(12);
    expect(result.analysisIds.length).toBeGreaterThanOrEqual(8);
    const [stages] = await db.select({ n: count() }).from(pipelineStages);
    expect(stages!.n).toBe(9);
    const [msgs] = await db.select({ n: count() }).from(messages);
    expect(msgs!.n).toBeGreaterThan(0);
    const [due] = await db.select({ n: count() }).from(tasks);
    expect(due!.n).toBeGreaterThan(0);
    const [reports] = await db.select({ n: count() }).from(propertyReports);
    expect(reports!.n).toBe(result.analysisIds.length);
  });

  it("is deterministic for the same seed value", async () => {
    const db2 = createPgliteDb();
    await migrate(db2);
    const again = await seed(db2, { seed: 7 });
    const a = await db.query.leads.findMany({ orderBy: (l, { asc }) => asc(l.createdAt) });
    const b = await db2.query.leads.findMany({ orderBy: (l, { asc }) => asc(l.createdAt) });
    expect(a.map((l) => l.motivationScore)).toEqual(b.map((l) => l.motivationScore));
    expect(again.analysisIds.length).toBe(result.analysisIds.length);
  });

  it("stores analysis outputs the engine can reproduce", async () => {
    const analysis = await db.query.dealAnalyses.findFirst({ where: eq(dealAnalyses.id, result.analysisIds[0]!) });
    expect(analysis).toBeTruthy();
    expect(Number(analysis!.netProfit)).toBeCloseTo((analysis!.outputs as any).acquisitions.netProfit, 1);
    const [n] = await db.select({ n: count() }).from(buyers);
    expect(n!.n).toBe(12);
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, result.leadIds[0]!) });
    expect(lead!.status).toBe("open");
  });
});
