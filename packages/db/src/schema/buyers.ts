import { pgTable, text, uuid, boolean, jsonb, numeric, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { base, fundingEnum, submissionResponseEnum } from "./_shared";
import { orgs, profiles } from "./identity";
import { properties } from "./properties";
import { dealAnalyses } from "./analyzer";
import type { Phone, EmailAddress } from "./properties";

export const buyers = pgTable("buyers", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  company: text("company"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  phones: jsonb("phones").$type<Phone[]>().notNull().default([]),
  emails: jsonb("emails").$type<EmailAddress[]>().notNull().default([]),
  website: text("website"),
  source: text("source"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
}, (t) => [index("buyers_org_idx").on(t.orgId)]);

export const buyerCriteria = pgTable("buyer_criteria", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  buyerId: uuid("buyer_id").notNull().references(() => buyers.id, { onDelete: "cascade" }),
  states: text("states").array().notNull().default([]),
  counties: text("counties").array().notNull().default([]),
  zips: text("zips").array().notNull().default([]),
  propertyTypes: text("property_types").array().notNull().default([]),
  priceMin: numeric("price_min", { precision: 14, scale: 2 }),
  priceMax: numeric("price_max", { precision: 14, scale: 2 }),
  arvPctMax: numeric("arv_pct_max", { precision: 5, scale: 4 }),
  buyingFormula: text("buying_formula"),
  conditionLevels: integer("condition_levels").array().notNull().default([]),
  occupancyPrefs: text("occupancy_prefs").array().notNull().default([]),
  funding: fundingEnum("funding").notNull().default("cash"),
  proofOfFundsOnFile: boolean("proof_of_funds_on_file").notNull().default(false),
  sightUnseen: boolean("sight_unseen").notNull().default(false),
  minMarginAmount: numeric("min_margin_amount", { precision: 14, scale: 2 }),
  minMarginPct: numeric("min_margin_pct", { precision: 5, scale: 4 }),
  closesInDays: integer("closes_in_days"),
}, (t) => [index("buyer_criteria_buyer_idx").on(t.buyerId)]);

export const buyerPurchases = pgTable("buyer_purchases", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  buyerId: uuid("buyer_id").notNull().references(() => buyers.id, { onDelete: "cascade" }),
  propertyId: uuid("property_id").references(() => properties.id, { onDelete: "set null" }),
  address: text("address"),
  price: numeric("price", { precision: 14, scale: 2 }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  notes: text("notes"),
});

export const dealPackages = pgTable("deal_packages", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  analysisId: uuid("analysis_id").notNull().references(() => dealAnalyses.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  storagePath: text("storage_path"),
  shareToken: text("share_token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  sections: jsonb("sections").$type<Record<string, boolean>>().notNull().default({}),
  generatedBy: uuid("generated_by").references(() => profiles.id, { onDelete: "set null" }),
}, (t) => [index("deal_packages_analysis_idx").on(t.analysisId)]);

export const dealSubmissions = pgTable("deal_submissions", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  analysisId: uuid("analysis_id").notNull().references(() => dealAnalyses.id, { onDelete: "cascade" }),
  buyerId: uuid("buyer_id").notNull().references(() => buyers.id, { onDelete: "cascade" }),
  packageId: uuid("package_id").references(() => dealPackages.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentVia: text("sent_via"),
  response: submissionResponseEnum("response").notNull().default("none"),
  responseAmount: numeric("response_amount", { precision: 14, scale: 2 }),
  notes: text("notes"),
  /** Per buyer share token, so an open can be attributed to one buyer rather than to the package. */
  token: text("token").unique(),
  firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
  openCount: integer("open_count").notNull().default(0),
}, (t) => [index("deal_submissions_analysis_idx").on(t.analysisId), index("deal_submissions_buyer_idx").on(t.buyerId)]);

/** One row per org. Weights learned from past submissions and their responses. Absent or under the sample floor means the default weights are used. */
export const buyerMatchModels = pgTable("buyer_match_models", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  weights: jsonb("weights").$type<Record<string, number>>().notNull().default({}),
  explanations: jsonb("explanations").$type<Record<string, string>>().notNull().default({}),
  sampleSize: integer("sample_size").notNull().default(0),
  trainedAt: timestamp("trained_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("buyer_match_models_org").on(t.orgId)]);
