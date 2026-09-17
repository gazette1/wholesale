import { pgTable, text, uuid, boolean, jsonb, numeric, integer, date, index, uniqueIndex } from "drizzle-orm/pg-core";
import { base, analysisStatusEnum } from "./_shared";
import { orgs, profiles } from "./identity";
import { properties } from "./properties";
import { leads } from "./pipeline";
import type { DealInput } from "@dealcalc/engine";

export const dealAnalyses = pgTable("deal_analyses", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  name: text("name").notNull(),
  status: analysisStatusEnum("status").notNull().default("draft"),
  inputs: jsonb("inputs").$type<DealInput>().notNull(),
  outputs: jsonb("outputs").$type<Record<string, unknown>>().notNull().default({}),
  engineVersion: text("engine_version").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  /** Denormalized for list views and buyer matching. Recomputed on save. */
  netProfit: numeric("net_profit", { precision: 14, scale: 2 }),
  maxAllowableOffer: numeric("max_allowable_offer", { precision: 14, scale: 2 }),
  spread: numeric("spread", { precision: 14, scale: 2 }),
  arv: numeric("arv", { precision: 14, scale: 2 }),
  purchasePrice: numeric("purchase_price", { precision: 14, scale: 2 }),
}, (t) => [
  uniqueIndex("deal_analyses_property_version").on(t.propertyId, t.version),
  index("deal_analyses_lead_idx").on(t.leadId),
  index("deal_analyses_org_status_idx").on(t.orgId, t.status),
]);

export const rehabLineItems = pgTable("rehab_line_items", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  analysisId: uuid("analysis_id").notNull().references(() => dealAnalyses.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  itemNumber: integer("item_number"),
  question: text("question"),
  option: text("option"),
  answer: text("answer"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }),
}, (t) => [uniqueIndex("rehab_line_items_unique").on(t.analysisId, t.rowNumber)]);

export const costDefaults = pgTable("cost_defaults", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  itemNumber: integer("item_number"),
  question: text("question"),
  option: text("option"),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
  unit: text("unit"),
  market: text("market"),
  asOf: date("as_of"),
}, (t) => [uniqueIndex("cost_defaults_org_row").on(t.orgId, t.rowNumber)]);
