import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../src/client";
import { migrate } from "../src/migrate";
import { orgs, profiles, properties, contacts, pipelineStages, leads, activities, dealAnalyses } from "../src/schema";
import { acquisitions, ENGINE_VERSION } from "@dealcalc/engine";

const db = createPgliteDb();

describe("schema on PGlite", () => {
  beforeAll(async () => {
    const applied = await migrate(db);
    expect(applied).toContain("0000_crm_init.sql");
  });

  it("creates an org, a profile, a property, a contact, a lead, and an analysis", async () => {
    const [org] = await db.insert(orgs).values({ name: "Test Org" }).returning();
    const [me] = await db.insert(profiles).values({ userId: crypto.randomUUID(), orgId: org!.id, fullName: "Russ", email: "russ@example.com", role: "admin" }).returning();
    const [stage] = await db.insert(pipelineStages).values({ orgId: org!.id, key: "new_lead", name: "New Lead", position: 1 }).returning();
    const [property] = await db.insert(properties).values({ orgId: org!.id, addressLine1: "123 Main St", city: "Baltimore", state: "MD", postalCode: "21201" }).returning();
    const [contact] = await db.insert(contacts).values({ orgId: org!.id, firstName: "Sam", lastName: "Seller", phones: [{ number: "+14105550100", type: "mobile", isPrimary: true }] }).returning();
    const [lead] = await db.insert(leads).values({ orgId: org!.id, propertyId: property!.id, primaryContactId: contact!.id, stageId: stage!.id, assignedTo: me!.id }).returning();
    await db.insert(activities).values({ orgId: org!.id, leadId: lead!.id, actorId: me!.id, type: "note", payload: { text: "hello" } });

    const inputs = {
      meta: { name: "v1" },
      rehab: { lines: [] },
      acquisitions: {
        holdMonths: 4, asIsValue: 200000, purchasePrice: 200000, arv: 300000, repairCosts: 20050, assignmentFee: -10000,
        firstLienAmount: 200000, firstPointsRate: 0.03, firstInterestRate: 0, firstMonthlyInterestOnlyRate: 0.14 / 12,
        secondLienAmount: 0, secondPointsRate: 0.1, secondInterestRate: 0, secondMonthlyInterestOnlyRate: 0,
        miscLienAmountPaid: 0, miscPointsPaid: 0, miscInterestPaid: 0, miscMonthlyInterestOnlyPaid: 0, miscFinancingCosts: 0,
        propertyTaxRate: 0.0875, hoaMonthly: 0, insuranceMonthly: 100, utilitiesMonthly: 0, gasMonthly: 150, waterMonthly: 100, electricityMonthly: 100, miscUtilitiesMonthly: 0,
        miscHoldingMonthly: [0, 0, 0, 0] as [number, number, number, number],
        buyEscrowRate: 0.005, buyTitleRate: 0.01, buyMiscRate: 0, sellEscrowRate: 0.005, sellRecordingRate: 0.0025, sellRealtorRate: 0.03, sellTransferRate: 0.0001,
        sellHomeWarranty: 0, sellStaging: 0, sellMarketing: 0, sellMisc: 0,
      },
    };
    const out = acquisitions(inputs.acquisitions);
    const [analysis] = await db.insert(dealAnalyses).values({
      orgId: org!.id, propertyId: property!.id, leadId: lead!.id, name: "Base case", inputs, outputs: { netProfit: out.netProfit },
      engineVersion: ENGINE_VERSION, netProfit: out.netProfit.toFixed(2), arv: "300000",
    }).returning();

    const found = await db.query.leads.findFirst({ where: eq(leads.id, lead!.id) });
    expect(found?.propertyId).toBe(property!.id);
    expect(Number(analysis!.netProfit)).toBeCloseTo(44453.33, 2);
  });

  it("enforces one analysis version per property", async () => {
    const org = await db.query.orgs.findFirst();
    const property = await db.query.properties.findFirst();
    await expect(
      db.insert(dealAnalyses).values({ orgId: org!.id, propertyId: property!.id, version: 1, name: "dup", inputs: { meta: { name: "x" }, rehab: { lines: [] }, acquisitions: {} as any }, engineVersion: ENGINE_VERSION }),
    ).rejects.toThrow();
  });
});
