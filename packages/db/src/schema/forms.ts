/** Workflow Forms. See docs/WORKFLOW_FORMS_PLAN.md. Definitions are JSON validated by @dealcalc/forms. */
import { pgTable, pgEnum, text, uuid, boolean, jsonb, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { base } from "./_shared";
import { orgs, profiles } from "./identity";
import { contacts } from "./properties";
import { leads } from "./pipeline";
import { buyers } from "./buyers";

export const formStatusEnum = pgEnum("form_status", ["draft", "published", "archived"]);
export const formSubjectTypeEnum = pgEnum("form_subject_type", ["lead", "buyer", "none"]);
export const formSubmissionStatusEnum = pgEnum("form_submission_status", ["draft", "in_progress", "waiting_approval", "sent_back", "completed", "archived"]);
export const formTaskStatusEnum = pgEnum("form_task_status", ["not_started", "open", "completed", "skipped"]);
export const formCompletionRuleEnum = pgEnum("form_completion_rule", ["any", "all", "minimum"]);
export const formApprovalOutcomeEnum = pgEnum("form_approval_outcome", ["approved", "rejected", "sent_back"]);
export const formExternalKindEnum = pgEnum("form_external_kind", ["invite", "public"]);
export const formEventKindEnum = pgEnum("form_event_kind", [
  "submission_started", "answer_changed", "section_opened", "section_completed", "section_skipped",
  "approved", "rejected", "sent_back", "reassigned", "snoozed", "commented", "version_migrated",
  "automation_run", "external_invited", "external_revoked", "external_signin", "archived", "restored", "purge",
]);
export const formPurgeStatusEnum = pgEnum("form_purge_status", ["pending", "executed", "cancelled"]);

export type FormSettingsJson = {
  subjectType?: "lead" | "buyer" | "none";
  whoMayStart?: ("admin" | "acquisitions" | "dispositions" | "viewer")[];
  allowPublicLink?: boolean;
  commentsEnabled?: boolean;
  timeZone?: string;
};
/** The definition JSON. Typed loosely here so the database package does not depend on the forms package. */
export type FormDefinitionJson = { schemaVersion?: number; roles?: unknown[]; sections?: unknown[]; rules?: unknown[] };

export const forms = pgTable("forms", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  status: formStatusEnum("status").notNull().default("draft"),
  ownerId: uuid("owner_id").references(() => profiles.id, { onDelete: "set null" }),
  /** The working copy the editor saves. Publishing freezes it into form_versions. */
  draftDefinition: jsonb("draft_definition").$type<FormDefinitionJson>().notNull().default({}),
  latestVersionId: uuid("latest_version_id"),
  settings: jsonb("settings").$type<FormSettingsJson>().notNull().default({}),
  templateSlug: text("template_slug"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  index("forms_org_status_idx").on(t.orgId, t.status),
  index("forms_org_category_idx").on(t.orgId, t.category),
]);

export const formVersions = pgTable("form_versions", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  formId: uuid("form_id").notNull().references(() => forms.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  definition: jsonb("definition").$type<FormDefinitionJson>().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  publishedBy: uuid("published_by").references(() => profiles.id, { onDelete: "set null" }),
}, (t) => [uniqueIndex("form_versions_form_number").on(t.formId, t.number)]);

export const formSubmissions = pgTable("form_submissions", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  formId: uuid("form_id").notNull().references(() => forms.id, { onDelete: "cascade" }),
  versionId: uuid("version_id").notNull().references(() => formVersions.id, { onDelete: "restrict" }),
  subjectType: formSubjectTypeEnum("subject_type").notNull().default("none"),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  buyerId: uuid("buyer_id").references(() => buyers.id, { onDelete: "set null" }),
  title: text("title"),
  status: formSubmissionStatusEnum("status").notNull().default("in_progress"),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
  startedBy: uuid("started_by").references(() => profiles.id, { onDelete: "set null" }),
  startedByExternalPartyId: uuid("started_by_external_party_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  editedAfterCompletion: boolean("edited_after_completion").notNull().default(false),
  dueAt: timestamp("due_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  index("form_submissions_org_status_idx").on(t.orgId, t.status),
  index("form_submissions_form_idx").on(t.orgId, t.formId, t.status),
  index("form_submissions_lead_idx").on(t.leadId),
  index("form_submissions_buyer_idx").on(t.buyerId),
  index("form_submissions_due_idx").on(t.orgId, t.dueAt),
]);

export const formTasks = pgTable("form_tasks", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").notNull().references(() => formSubmissions.id, { onDelete: "cascade" }),
  sectionKey: text("section_key").notNull(),
  roleKey: text("role_key"),
  status: formTaskStatusEnum("status").notNull().default("not_started"),
  completionRule: formCompletionRuleEnum("completion_rule").notNull().default("any"),
  minimumCount: integer("minimum_count"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  approvalOutcome: formApprovalOutcomeEnum("approval_outcome"),
  /** On a send back: the earlier section reopened. */
  sentBackToSectionKey: text("sent_back_to_section_key"),
  /** On a reopened section: the approval section to return to when it completes again. */
  returnToSectionKey: text("return_to_section_key"),
  dueSoonNotifiedAt: timestamp("due_soon_notified_at", { withTimezone: true }),
  overdueNotifiedAt: timestamp("overdue_notified_at", { withTimezone: true }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("form_tasks_submission_section").on(t.submissionId, t.sectionKey),
  index("form_tasks_org_status_idx").on(t.orgId, t.status),
  index("form_tasks_due_idx").on(t.orgId, t.status, t.dueAt),
]);

export const formExternalParties = pgTable("form_external_parties", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  formId: uuid("form_id").notNull().references(() => forms.id, { onDelete: "cascade" }),
  /** Null for a public link, which starts a new submission per visitor. */
  submissionId: uuid("submission_id").references(() => formSubmissions.id, { onDelete: "cascade" }),
  kind: formExternalKindEnum("kind").notNull().default("invite"),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  buyerId: uuid("buyer_id").references(() => buyers.id, { onDelete: "set null" }),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  /** Section keys this party may fill. */
  sectionKeys: jsonb("section_keys").$type<string[]>().notNull().default([]),
  /** sha256 of the link token. The token itself is shown once and never stored. */
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  singleUse: boolean("single_use").notNull().default(false),
  usedAt: timestamp("used_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  codeHash: text("code_hash"),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
  codeAttempts: integer("code_attempts").notNull().default(0),
  codeSendCount: integer("code_send_count").notNull().default(0),
  codeWindowStartedAt: timestamp("code_window_started_at", { withTimezone: true }),
  lastCodeSentAt: timestamp("last_code_sent_at", { withTimezone: true }),
  sessionHash: text("session_hash"),
  sessionExpiresAt: timestamp("session_expires_at", { withTimezone: true }),
  invitedBy: uuid("invited_by").references(() => profiles.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("form_external_parties_token").on(t.tokenHash),
  index("form_external_parties_submission_idx").on(t.submissionId),
  index("form_external_parties_form_idx").on(t.orgId, t.formId),
]);

export const formTaskAssignees = pgTable("form_task_assignees", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => formTasks.id, { onDelete: "cascade" }),
  profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
  externalPartyId: uuid("external_party_id").references(() => formExternalParties.id, { onDelete: "cascade" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** Last time the assignee opened the task. Drives the unread count. */
  seenAt: timestamp("seen_at", { withTimezone: true }),
  removedAt: timestamp("removed_at", { withTimezone: true }),
}, (t) => [
  index("form_task_assignees_task_idx").on(t.taskId),
  index("form_task_assignees_profile_idx").on(t.orgId, t.profileId, t.completedAt),
  index("form_task_assignees_external_idx").on(t.externalPartyId),
]);

export const formComments = pgTable("form_comments", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").notNull().references(() => formSubmissions.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => formTasks.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  authorExternalPartyId: uuid("author_external_party_id").references(() => formExternalParties.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  documentIds: jsonb("document_ids").$type<string[]>().notNull().default([]),
  mentionIds: jsonb("mention_ids").$type<string[]>().notNull().default([]),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [index("form_comments_task_idx").on(t.submissionId, t.taskId)]);

export const formEvents = pgTable("form_events", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  formId: uuid("form_id").references(() => forms.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").references(() => formSubmissions.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => formTasks.id, { onDelete: "set null" }),
  actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
  actorExternalPartyId: uuid("actor_external_party_id").references(() => formExternalParties.id, { onDelete: "set null" }),
  /** Email or phone of an external actor, kept so the log reads without a join. */
  actorLabel: text("actor_label"),
  kind: formEventKindEnum("kind").notNull(),
  fieldKey: text("field_key"),
  before: jsonb("before"),
  after: jsonb("after"),
  versionId: uuid("version_id").references(() => formVersions.id, { onDelete: "set null" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("form_events_submission_idx").on(t.submissionId, t.at),
  index("form_events_task_idx").on(t.taskId, t.at),
  index("form_events_org_kind_idx").on(t.orgId, t.kind, t.at),
]);

/** A purge of one person's data. Executes only after a second admin approves. The row keeps no purged data. */
export const formPurgeRequests = pgTable("form_purge_requests", {
  ...base,
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  /** external_party, contact, or buyer. */
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  requestReference: text("request_reference").notNull(),
  status: formPurgeStatusEnum("status").notNull().default("pending"),
  requestedBy: uuid("requested_by").notNull().references(() => profiles.id, { onDelete: "restrict" }),
  approvedBy: uuid("approved_by").references(() => profiles.id, { onDelete: "restrict" }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  /** Counts only, for example { answers: 3, comments: 1 }. */
  summary: jsonb("summary").$type<Record<string, number>>().notNull().default({}),
}, (t) => [index("form_purge_requests_org_status_idx").on(t.orgId, t.status)]);
