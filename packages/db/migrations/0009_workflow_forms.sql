CREATE TYPE "public"."notify_by" AS ENUM('email', 'sms', 'both');--> statement-breakpoint
CREATE TYPE "public"."form_approval_outcome" AS ENUM('approved', 'rejected', 'sent_back');--> statement-breakpoint
CREATE TYPE "public"."form_completion_rule" AS ENUM('any', 'all', 'minimum');--> statement-breakpoint
CREATE TYPE "public"."form_event_kind" AS ENUM('submission_started', 'answer_changed', 'section_opened', 'section_completed', 'section_skipped', 'approved', 'rejected', 'sent_back', 'reassigned', 'snoozed', 'commented', 'version_migrated', 'automation_run', 'external_invited', 'external_revoked', 'external_signin', 'archived', 'restored', 'purge');--> statement-breakpoint
CREATE TYPE "public"."form_external_kind" AS ENUM('invite', 'public');--> statement-breakpoint
CREATE TYPE "public"."form_purge_status" AS ENUM('pending', 'executed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."form_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."form_subject_type" AS ENUM('lead', 'buyer', 'none');--> statement-breakpoint
CREATE TYPE "public"."form_submission_status" AS ENUM('draft', 'in_progress', 'waiting_approval', 'sent_back', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."form_task_status" AS ENUM('not_started', 'open', 'completed', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'form';--> statement-breakpoint
ALTER TYPE "public"."alert_kind" ADD VALUE 'form_due_soon';--> statement-breakpoint
ALTER TYPE "public"."alert_kind" ADD VALUE 'form_overdue';--> statement-breakpoint
ALTER TYPE "public"."alert_kind" ADD VALUE 'form_escalation';--> statement-breakpoint
CREATE TABLE "form_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submission_id" uuid NOT NULL,
	"task_id" uuid,
	"author_id" uuid,
	"author_external_party_id" uuid,
	"body" text NOT NULL,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mention_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form_id" uuid,
	"submission_id" uuid,
	"task_id" uuid,
	"actor_id" uuid,
	"actor_external_party_id" uuid,
	"actor_label" text,
	"kind" "form_event_kind" NOT NULL,
	"field_key" text,
	"before" jsonb,
	"after" jsonb,
	"version_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_external_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form_id" uuid NOT NULL,
	"submission_id" uuid,
	"kind" "form_external_kind" DEFAULT 'invite' NOT NULL,
	"contact_id" uuid,
	"buyer_id" uuid,
	"name" text,
	"email" text,
	"phone" text,
	"section_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"single_use" boolean DEFAULT false NOT NULL,
	"used_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"code_send_count" integer DEFAULT 0 NOT NULL,
	"code_window_started_at" timestamp with time zone,
	"last_code_sent_at" timestamp with time zone,
	"session_hash" text,
	"session_expires_at" timestamp with time zone,
	"invited_by" uuid,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_purge_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"request_reference" text NOT NULL,
	"status" "form_purge_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"executed_at" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"subject_type" "form_subject_type" DEFAULT 'none' NOT NULL,
	"lead_id" uuid,
	"buyer_id" uuid,
	"title" text,
	"status" "form_submission_status" DEFAULT 'in_progress' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_by" uuid,
	"started_by_external_party_id" uuid,
	"completed_at" timestamp with time zone,
	"edited_after_completion" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_task_assignees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"task_id" uuid NOT NULL,
	"profile_id" uuid,
	"external_party_id" uuid,
	"completed_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submission_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"role_key" text,
	"status" "form_task_status" DEFAULT 'not_started' NOT NULL,
	"completion_rule" "form_completion_rule" DEFAULT 'any' NOT NULL,
	"minimum_count" integer,
	"due_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"approval_outcome" "form_approval_outcome",
	"sent_back_to_section_key" text,
	"return_to_section_key" text,
	"due_soon_notified_at" timestamp with time zone,
	"overdue_notified_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"status" "form_status" DEFAULT 'draft' NOT NULL,
	"owner_id" uuid,
	"draft_definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latest_version_id" uuid,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template_slug" text,
	"last_used_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "is_form_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "notify_by" "notify_by" DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "mobile_phone" text;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "form_task_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "submission_id" uuid;--> statement-breakpoint
ALTER TABLE "form_comments" ADD CONSTRAINT "form_comments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_comments" ADD CONSTRAINT "form_comments_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_comments" ADD CONSTRAINT "form_comments_task_id_form_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."form_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_comments" ADD CONSTRAINT "form_comments_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_comments" ADD CONSTRAINT "form_comments_author_external_party_id_form_external_parties_id_fk" FOREIGN KEY ("author_external_party_id") REFERENCES "public"."form_external_parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_task_id_form_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."form_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_actor_external_party_id_form_external_parties_id_fk" FOREIGN KEY ("actor_external_party_id") REFERENCES "public"."form_external_parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_version_id_form_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."form_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_external_parties" ADD CONSTRAINT "form_external_parties_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_external_parties" ADD CONSTRAINT "form_external_parties_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_external_parties" ADD CONSTRAINT "form_external_parties_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_external_parties" ADD CONSTRAINT "form_external_parties_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_external_parties" ADD CONSTRAINT "form_external_parties_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_external_parties" ADD CONSTRAINT "form_external_parties_invited_by_profiles_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_purge_requests" ADD CONSTRAINT "form_purge_requests_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_purge_requests" ADD CONSTRAINT "form_purge_requests_requested_by_profiles_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_purge_requests" ADD CONSTRAINT "form_purge_requests_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_version_id_form_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."form_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_started_by_profiles_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_task_assignees" ADD CONSTRAINT "form_task_assignees_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_task_assignees" ADD CONSTRAINT "form_task_assignees_task_id_form_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."form_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_task_assignees" ADD CONSTRAINT "form_task_assignees_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_task_assignees" ADD CONSTRAINT "form_task_assignees_external_party_id_form_external_parties_id_fk" FOREIGN KEY ("external_party_id") REFERENCES "public"."form_external_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_tasks" ADD CONSTRAINT "form_tasks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_tasks" ADD CONSTRAINT "form_tasks_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_published_by_profiles_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_comments_task_idx" ON "form_comments" USING btree ("submission_id","task_id");--> statement-breakpoint
CREATE INDEX "form_events_submission_idx" ON "form_events" USING btree ("submission_id","at");--> statement-breakpoint
CREATE INDEX "form_events_task_idx" ON "form_events" USING btree ("task_id","at");--> statement-breakpoint
CREATE INDEX "form_events_org_kind_idx" ON "form_events" USING btree ("org_id","kind","at");--> statement-breakpoint
CREATE UNIQUE INDEX "form_external_parties_token" ON "form_external_parties" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "form_external_parties_submission_idx" ON "form_external_parties" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "form_external_parties_form_idx" ON "form_external_parties" USING btree ("org_id","form_id");--> statement-breakpoint
CREATE INDEX "form_purge_requests_org_status_idx" ON "form_purge_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "form_submissions_org_status_idx" ON "form_submissions" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "form_submissions_form_idx" ON "form_submissions" USING btree ("org_id","form_id","status");--> statement-breakpoint
CREATE INDEX "form_submissions_lead_idx" ON "form_submissions" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "form_submissions_buyer_idx" ON "form_submissions" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "form_submissions_due_idx" ON "form_submissions" USING btree ("org_id","due_at");--> statement-breakpoint
CREATE INDEX "form_task_assignees_task_idx" ON "form_task_assignees" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "form_task_assignees_profile_idx" ON "form_task_assignees" USING btree ("org_id","profile_id","completed_at");--> statement-breakpoint
CREATE INDEX "form_task_assignees_external_idx" ON "form_task_assignees" USING btree ("external_party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_tasks_submission_section" ON "form_tasks" USING btree ("submission_id","section_key");--> statement-breakpoint
CREATE INDEX "form_tasks_org_status_idx" ON "form_tasks" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "form_tasks_due_idx" ON "form_tasks" USING btree ("org_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_form_number" ON "form_versions" USING btree ("form_id","number");--> statement-breakpoint
CREATE INDEX "forms_org_status_idx" ON "forms" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "forms_org_category_idx" ON "forms" USING btree ("org_id","category");--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_form_task_id_form_tasks_id_fk" FOREIGN KEY ("form_task_id") REFERENCES "public"."form_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_submission_idx" ON "documents" USING btree ("submission_id");--> statement-breakpoint
-- Admins hold the form admin capability by default.
UPDATE "profiles" SET "is_form_admin" = true WHERE "role" = 'admin';
