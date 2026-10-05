import { pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Columns every table carries. org_id scopes row level security. */
export const base = {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Set by the ORM on every update as well as by the Supabase trigger, so PGlite and hosted Postgres agree.
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

export const roleEnum = pgEnum("role", ["admin", "acquisitions", "dispositions", "viewer"]);
export const occupancyEnum = pgEnum("occupancy", ["owner", "tenant", "vacant", "unknown"]);
export const conditionEnum = pgEnum("condition", ["1", "2", "3", "4", "5", "unknown"]);
export const relationshipEnum = pgEnum("relationship", ["owner", "heir", "agent", "attorney", "tenant", "other"]);
export const consentEnum = pgEnum("consent", ["unknown", "opted_in", "opted_out"]);
export const leadStatusEnum = pgEnum("lead_status", ["open", "won", "lost", "nurture"]);
export const urgencyEnum = pgEnum("urgency", ["none", "low", "medium", "high", "immediate"]);
export const activityTypeEnum = pgEnum("activity_type", ["call", "sms", "email", "note", "stage_change", "offer", "task", "enrichment", "document", "analysis", "system"]);
export const taskKindEnum = pgEnum("task_kind", ["call", "text", "email", "visit", "other"]);
export const tagKindEnum = pgEnum("tag_kind", ["lead", "buyer", "issue"]);
export const offerTypeEnum = pgEnum("offer_type", ["cash", "creative", "assignment"]);
export const offerStatusEnum = pgEnum("offer_status", ["draft", "sent", "countered", "accepted", "rejected", "expired"]);
export const reportStatusEnum = pgEnum("report_status", ["ok", "partial", "failed"]);
export const compSourceEnum = pgEnum("comp_source", ["provider", "manual"]);
export const channelEnum = pgEnum("channel", ["sms", "email"]);
export const directionEnum = pgEnum("direction", ["in", "out"]);
export const messageStatusEnum = pgEnum("message_status", ["queued", "sent", "delivered", "failed", "received", "undelivered"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "active", "paused", "done"]);
export const enrollmentStatusEnum = pgEnum("enrollment_status", ["active", "replied", "stopped", "done", "opted_out"]);
export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "done", "failed"]);
export const analysisStatusEnum = pgEnum("analysis_status", ["draft", "reviewing", "approved_for_offer", "rejected"]);
export const fundingEnum = pgEnum("funding", ["cash", "hard_money", "conventional", "mixed"]);
export const submissionResponseEnum = pgEnum("submission_response", ["none", "interested", "pass", "offer"]);
export const savedViewEntityEnum = pgEnum("saved_view_entity", ["leads", "buyers"]);
export const callStatusEnum = pgEnum("call_status", ["queued", "ringing", "in_progress", "completed", "busy", "no_answer", "failed", "canceled"]);
export const alertKindEnum = pgEnum("alert_kind", ["lead_untouched", "follow_up_overdue", "offer_expiring"]);
export const scoreReviewStatusEnum = pgEnum("score_review_status", ["auto_applied", "suggested", "needs_review", "accepted", "overridden"]);
