import { pgTable, text, uuid, boolean, jsonb, numeric, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { base, reportStatusEnum, compSourceEnum } from "./_shared";
import { orgs } from "./identity";
import { properties } from "./properties";

/** Provider neutral shape every property data adapter must produce. */
export type NormalizedPropertyReport = {
  characteristics: { propertyType?: string; beds?: number; baths?: number; sqft?: number; lotSqft?: number; yearBuilt?: number; stories?: number; garage?: string; pool?: boolean; units?: number };
  owner: { names: string[]; mailingAddress?: string; ownerOccupied?: boolean; absentee?: boolean; ownerType?: "individual" | "entity" | "trust" | "unknown"; yearsOwned?: number };
  valuation: { avm?: number; avmLow?: number; avmHigh?: number; confidence?: number; rentEstimate?: number; asOf?: string };
  mortgages: { lender?: string; amount?: number; originatedAt?: string; rate?: number; type?: string; estimatedBalance?: number; position?: number }[];
  liens: { kind: string; amount?: number; recordedAt?: string; holder?: string }[];
  transactions: { date: string; price?: number; buyer?: string; seller?: string; type?: string; documentNumber?: string }[];
  tax: { assessedValue?: number; assessedLand?: number; assessedImprovement?: number; taxAmount?: number; taxYear?: number; delinquent?: boolean; exemptions?: string[] };
  distress: { preForeclosure?: boolean; foreclosureStage?: string; taxDelinquent?: boolean; vacant?: boolean; probate?: boolean; bankruptcy?: boolean; divorce?: boolean; flags: string[] };
  location: { lat?: number; lng?: number; county?: string; subdivision?: string; schoolDistrict?: string; floodZone?: string };
  arv: { estimate?: number; low?: number; high?: number; perSqft?: number; compCount?: number; method?: string };
};

export const propertyReports = pgTable("property_reports", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  status: reportStatusEnum("status").notNull().default("ok"),
  normalized: jsonb("normalized").$type<NormalizedPropertyReport>().notNull(),
  raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
  costCents: integer("cost_cents").notNull().default(0),
  error: text("error"),
}, (t) => [index("property_reports_property_time_idx").on(t.propertyId, t.fetchedAt)]);

export const comps = pgTable("comps", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  reportId: uuid("report_id").references(() => propertyReports.id, { onDelete: "set null" }),
  source: compSourceEnum("source").notNull().default("provider"),
  address: text("address").notNull(),
  soldPrice: numeric("sold_price", { precision: 14, scale: 2 }),
  soldAt: timestamp("sold_at", { withTimezone: true }),
  sqft: integer("sqft"),
  beds: numeric("beds", { precision: 4, scale: 1 }),
  baths: numeric("baths", { precision: 4, scale: 1 }),
  yearBuilt: integer("year_built"),
  distanceMi: numeric("distance_mi", { precision: 6, scale: 2 }),
  adjustedPrice: numeric("adjusted_price", { precision: 14, scale: 2 }),
  adjustments: jsonb("adjustments").$type<Record<string, number>>().notNull().default({}),
  included: boolean("included").notNull().default(true),
  notes: text("notes"),
}, (t) => [index("comps_property_idx").on(t.propertyId)]);

/** One row per org. Controls automatic property reports on new leads and what they may cost. Spend is read from property_reports.cost_cents. */
export const enrichmentSettings = pgTable("enrichment_settings", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  autoEnrichOnCreate: boolean("auto_enrich_on_create").notNull().default(false),
  /** Most one lead may cost across all of its reports, in cents. */
  perLeadCapCents: integer("per_lead_cap_cents").notNull().default(100),
  /** Most the org may spend on reports in one calendar month, in cents. */
  monthlyBudgetCents: integer("monthly_budget_cents").notNull().default(5000),
}, (t) => [uniqueIndex("enrichment_settings_org").on(t.orgId)]);
