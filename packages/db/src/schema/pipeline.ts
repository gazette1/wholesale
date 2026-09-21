import { pgTable, text, uuid, boolean, jsonb, numeric, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { base, leadStatusEnum, urgencyEnum, activityTypeEnum, taskKindEnum, tagKindEnum, offerTypeEnum, offerStatusEnum, savedViewEntityEnum, alertKindEnum, scoreReviewStatusEnum } from "./_shared";
import { orgs, profiles } from "./identity";
import { properties, contacts } from "./properties";

/** Deal thesis checklist. One boolean and one note per issue, plus a derived score. See docs/CRM_ARCHITECTURE.md 4.7. */
export type DealIssueKey =
  | "dirty_title" | "probate_or_inherited" | "liens_or_judgments" | "mortgage_default_or_foreclosure"
  | "code_violations" | "poor_condition" | "occupied_by_tenant" | "occupied_by_squatter" | "seller_urgency"
  | "divorce_or_partner_dispute" | "tax_delinquent" | "hoarder_or_environmental" | "other";
export type DealIssues = Partial<Record<DealIssueKey, { flagged: boolean; note?: string }>> & { messyScore?: number };

export const pipelineStages = pgTable("pipeline_stages", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  isTerminal: boolean("is_terminal").notNull().default(false),
  color: text("color"),
}, (t) => [uniqueIndex("pipeline_stages_org_key").on(t.orgId, t.key)]);

export const leadSources = pgTable("lead_sources", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  costPerLead: numeric("cost_per_lead", { precision: 12, scale: 2 }),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("lead_sources_org_name").on(t.orgId, t.name)]);

export const leads = pgTable("leads", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  propertyId: uuid("property_id").notNull().references(() => properties.id, { onDelete: "restrict" }),
  primaryContactId: uuid("primary_contact_id").references(() => contacts.id, { onDelete: "set null" }),
  stageId: uuid("stage_id").notNull().references(() => pipelineStages.id, { onDelete: "restrict" }),
  sourceId: uuid("source_id").references(() => leadSources.id, { onDelete: "set null" }),
  assignedTo: uuid("assigned_to").references(() => profiles.id, { onDelete: "set null" }),
  status: leadStatusEnum("status").notNull().default("open"),
  motivationScore: integer("motivation_score"),
  sellerUrgency: urgencyEnum("seller_urgency").notNull().default("none"),
  askingPrice: numeric("asking_price", { precision: 14, scale: 2 }),
  nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  contactAttempts: integer("contact_attempts").notNull().default(0),
  firstResponseMinutes: integer("first_response_minutes"),
  lostReason: text("lost_reason"),
  dealIssues: jsonb("deal_issues").$type<DealIssues>().notNull().default({}),
  stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("leads_org_stage_idx").on(t.orgId, t.stageId),
  index("leads_assigned_idx").on(t.orgId, t.assignedTo),
  index("leads_follow_up_idx").on(t.orgId, t.nextFollowUpAt),
  index("leads_property_idx").on(t.propertyId),
]);

export const activities = pgTable("activities", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  propertyId: uuid("property_id").references(() => properties.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
  type: activityTypeEnum("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("activities_lead_time_idx").on(t.leadId, t.occurredAt)]);

export const tasks = pgTable("tasks", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  assignedTo: uuid("assigned_to").references(() => profiles.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  kind: taskKindEnum("kind").notNull().default("call"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  doneAt: timestamp("done_at", { withTimezone: true }),
}, (t) => [index("tasks_due_idx").on(t.orgId, t.assignedTo, t.dueAt)]);

export const tags = pgTable("tags", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  kind: tagKindEnum("kind").notNull().default("lead"),
}, (t) => [uniqueIndex("tags_org_kind_name").on(t.orgId, t.kind, t.name)]);

export const leadTags = pgTable("lead_tags", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("lead_tags_unique").on(t.leadId, t.tagId)]);

export const offers = pgTable("offers", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  analysisId: uuid("analysis_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  type: offerTypeEnum("type").notNull().default("cash"),
  status: offerStatusEnum("status").notNull().default("draft"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentVia: text("sent_via"),
  counterAmount: numeric("counter_amount", { precision: 14, scale: 2 }),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  /** Set when status becomes accepted. Reporting measures days to acceptance from this, not from the current stage. */
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (t) => [index("offers_lead_idx").on(t.leadId), index("offers_expires_idx").on(t.orgId, t.expiresAt)]);

export const documents = pgTable("documents", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  propertyId: uuid("property_id").references(() => properties.id, { onDelete: "cascade" }),
  buyerId: uuid("buyer_id"),
  storagePath: text("storage_path").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => profiles.id, { onDelete: "set null" }),
}, (t) => [index("documents_lead_idx").on(t.leadId)]);

/** Raised by the cron dispatcher. dedupe_key is what stops a repeat run from raising the same alert twice. */
export const alerts = pgTable("alerts", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  recipientId: uuid("recipient_id").references(() => profiles.id, { onDelete: "cascade" }),
  kind: alertKindEnum("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  dedupeKey: text("dedupe_key").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("alerts_org_dedupe").on(t.orgId, t.dedupeKey),
  index("alerts_recipient_idx").on(t.orgId, t.recipientId, t.readAt),
  index("alerts_lead_idx").on(t.leadId),
]);

/** One row per scoring run. leads.motivation_score is only written when confidence clears the auto apply threshold. */
export const leadScores = pgTable("lead_scores", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  provider: text("provider").notNull(),
  reviewStatus: scoreReviewStatusEnum("review_status").notNull().default("needs_review"),
  reviewedBy: uuid("reviewed_by").references(() => profiles.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  overrideScore: integer("override_score"),
}, (t) => [
  index("lead_scores_lead_idx").on(t.leadId, t.createdAt),
  index("lead_scores_review_idx").on(t.orgId, t.reviewStatus),
]);

export const savedViews = pgTable("saved_views", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  entity: savedViewEntityEnum("entity").notNull(),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
  sort: jsonb("sort").$type<{ id: string; desc: boolean }[]>().notNull().default([]),
  columns: jsonb("columns").$type<string[]>().notNull().default([]),
  isShared: boolean("is_shared").notNull().default(false),
});
