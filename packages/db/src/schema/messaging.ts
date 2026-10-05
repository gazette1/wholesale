import { pgTable, text, uuid, boolean, jsonb, integer, timestamp, index } from "drizzle-orm/pg-core";
import { base, channelEnum, directionEnum, messageStatusEnum, campaignStatusEnum, enrollmentStatusEnum, jobStatusEnum, callStatusEnum } from "./_shared";
import { orgs, profiles } from "./identity";
import { leads } from "./pipeline";
import { contacts } from "./properties";

export const messageTemplates = pgTable("message_templates", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  channel: channelEnum("channel").notNull(),
  name: text("name").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  mergeFields: text("merge_fields").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
});

export const campaigns = pgTable("campaigns", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  channel: channelEnum("channel").notNull(),
  status: campaignStatusEnum("status").notNull().default("draft"),
  segment: jsonb("segment").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  startsAt: timestamp("starts_at", { withTimezone: true }),
});

export const campaignSteps = pgTable("campaign_steps", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  delayHours: integer("delay_hours").notNull().default(0),
  templateId: uuid("template_id").notNull().references(() => messageTemplates.id, { onDelete: "restrict" }),
  stopOnReply: boolean("stop_on_reply").notNull().default(true),
}, (t) => [index("campaign_steps_campaign_idx").on(t.campaignId, t.position)]);

export const campaignEnrollments = pgTable("campaign_enrollments", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  currentStep: integer("current_step").notNull().default(0),
  nextSendAt: timestamp("next_send_at", { withTimezone: true }),
  status: enrollmentStatusEnum("status").notNull().default("active"),
}, (t) => [index("campaign_enrollments_due_idx").on(t.status, t.nextSendAt)]);

export const messages = pgTable("messages", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  channel: channelEnum("channel").notNull(),
  direction: directionEnum("direction").notNull(),
  fromAddr: text("from_addr").notNull(),
  toAddr: text("to_addr").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  templateId: uuid("template_id").references(() => messageTemplates.id, { onDelete: "set null" }),
  campaignStepId: uuid("campaign_step_id").references(() => campaignSteps.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  providerMessageId: text("provider_message_id"),
  status: messageStatusEnum("status").notNull().default("queued"),
  statusAt: timestamp("status_at", { withTimezone: true }),
  error: text("error"),
  sentBy: uuid("sent_by").references(() => profiles.id, { onDelete: "set null" }),
  /** Consent state and other facts captured at send time. */
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  index("messages_lead_time_idx").on(t.leadId, t.createdAt),
  index("messages_provider_id_idx").on(t.providerMessageId),
]);

export const jobs = pgTable("jobs", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: jobStatusEnum("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
}, (t) => [index("jobs_due_idx").on(t.status, t.runAt)]);

/** Voice calls placed or received through the voice provider. One row per call leg the team cares about. */
export const calls = pgTable("calls", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  direction: directionEnum("direction").notNull(),
  fromAddr: text("from_addr").notNull(),
  toAddr: text("to_addr").notNull(),
  provider: text("provider").notNull(),
  providerCallId: text("provider_call_id"),
  status: callStatusEnum("status").notNull().default("queued"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  recordingUrl: text("recording_url"),
  outcome: text("outcome"),
  notes: text("notes"),
  placedBy: uuid("placed_by").references(() => profiles.id, { onDelete: "set null" }),
}, (t) => [
  index("calls_lead_time_idx").on(t.leadId, t.createdAt),
  index("calls_provider_id_idx").on(t.providerCallId),
]);
