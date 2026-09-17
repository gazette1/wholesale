CREATE TYPE "public"."activity_type" AS ENUM('call', 'sms', 'email', 'note', 'stage_change', 'offer', 'task', 'enrichment', 'document', 'analysis', 'system');--> statement-breakpoint
CREATE TYPE "public"."analysis_status" AS ENUM('draft', 'reviewing', 'approved_for_offer', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'done');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."comp_source" AS ENUM('provider', 'manual');--> statement-breakpoint
CREATE TYPE "public"."condition" AS ENUM('1', '2', '3', '4', '5', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."consent" AS ENUM('unknown', 'opted_in', 'opted_out');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'replied', 'stopped', 'done', 'opted_out');--> statement-breakpoint
CREATE TYPE "public"."funding" AS ENUM('cash', 'hard_money', 'conventional', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('open', 'won', 'lost', 'nurture');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'received', 'undelivered');--> statement-breakpoint
CREATE TYPE "public"."occupancy" AS ENUM('owner', 'tenant', 'vacant', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('draft', 'sent', 'countered', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."offer_type" AS ENUM('cash', 'creative', 'assignment');--> statement-breakpoint
CREATE TYPE "public"."relationship" AS ENUM('owner', 'heir', 'agent', 'attorney', 'tenant', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('ok', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'acquisitions', 'dispositions', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."saved_view_entity" AS ENUM('leads', 'buyers');--> statement-breakpoint
CREATE TYPE "public"."submission_response" AS ENUM('none', 'interested', 'pass', 'offer');--> statement-breakpoint
CREATE TYPE "public"."tag_kind" AS ENUM('lead', 'buyer', 'issue');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('call', 'text', 'email', 'visit', 'other');--> statement-breakpoint
CREATE TYPE "public"."urgency" AS ENUM('none', 'low', 'medium', 'high', 'immediate');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"org_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" "role" DEFAULT 'viewer' NOT NULL,
	"twilio_number" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mailing_address" text,
	"relationship" "relationship" DEFAULT 'owner' NOT NULL,
	"sms_consent" "consent" DEFAULT 'unknown' NOT NULL,
	"sms_consent_at" timestamp with time zone,
	"email_consent" "consent" DEFAULT 'unknown' NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"county" text,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"apn" text,
	"property_type" text,
	"beds" numeric(4, 1),
	"baths" numeric(4, 1),
	"sqft" integer,
	"lot_sqft" integer,
	"year_built" integer,
	"units" integer DEFAULT 1 NOT NULL,
	"occupancy" "occupancy" DEFAULT 'unknown' NOT NULL,
	"condition" "condition" DEFAULT 'unknown' NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "property_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"property_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" "relationship" DEFAULT 'owner' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid,
	"property_id" uuid,
	"actor_id" uuid,
	"type" "activity_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid,
	"property_id" uuid,
	"buyer_id" uuid,
	"storage_path" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"cost_per_lead" numeric(12, 2),
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"property_id" uuid NOT NULL,
	"primary_contact_id" uuid,
	"stage_id" uuid NOT NULL,
	"source_id" uuid,
	"assigned_to" uuid,
	"status" "lead_status" DEFAULT 'open' NOT NULL,
	"motivation_score" integer,
	"seller_urgency" "urgency" DEFAULT 'none' NOT NULL,
	"asking_price" numeric(14, 2),
	"next_follow_up_at" timestamp with time zone,
	"last_contact_at" timestamp with time zone,
	"contact_attempts" integer DEFAULT 0 NOT NULL,
	"first_response_minutes" integer,
	"lost_reason" text,
	"deal_issues" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid NOT NULL,
	"analysis_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"type" "offer_type" DEFAULT 'cash' NOT NULL,
	"status" "offer_status" DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_via" text,
	"counter_amount" numeric(14, 2),
	"notes" text,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_id" uuid NOT NULL,
	"entity" "saved_view_entity" NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"kind" "tag_kind" DEFAULT 'lead' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid,
	"assigned_to" uuid,
	"title" text NOT NULL,
	"kind" "task_kind" DEFAULT 'call' NOT NULL,
	"due_at" timestamp with time zone,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"property_id" uuid NOT NULL,
	"report_id" uuid,
	"source" "comp_source" DEFAULT 'provider' NOT NULL,
	"address" text NOT NULL,
	"sold_price" numeric(14, 2),
	"sold_at" timestamp with time zone,
	"sqft" integer,
	"beds" numeric(4, 1),
	"baths" numeric(4, 1),
	"year_built" integer,
	"distance_mi" numeric(6, 2),
	"adjusted_price" numeric(14, 2),
	"adjustments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "property_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"property_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "report_status" DEFAULT 'ok' NOT NULL,
	"normalized" jsonb NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "campaign_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"next_send_at" timestamp with time zone,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"delay_hours" integer DEFAULT 0 NOT NULL,
	"template_id" uuid NOT NULL,
	"stop_on_reply" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"channel" "channel" NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"segment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"starts_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" "channel" NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"merge_fields" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid,
	"contact_id" uuid,
	"channel" "channel" NOT NULL,
	"direction" "direction" NOT NULL,
	"from_addr" text NOT NULL,
	"to_addr" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"template_id" uuid,
	"campaign_step_id" uuid,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"status_at" timestamp with time zone,
	"error" text,
	"sent_by" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_defaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_number" integer NOT NULL,
	"item_number" integer,
	"question" text,
	"option" text,
	"unit_cost" numeric(12, 2),
	"unit" text,
	"market" text,
	"as_of" date
);
--> statement-breakpoint
CREATE TABLE "deal_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"property_id" uuid NOT NULL,
	"lead_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"status" "analysis_status" DEFAULT 'draft' NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" uuid,
	"net_profit" numeric(14, 2),
	"max_allowable_offer" numeric(14, 2),
	"spread" numeric(14, 2),
	"arv" numeric(14, 2),
	"purchase_price" numeric(14, 2)
);
--> statement-breakpoint
CREATE TABLE "rehab_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"item_number" integer,
	"question" text,
	"option" text,
	"answer" text,
	"quantity" numeric(12, 2),
	"unit_cost" numeric(12, 2),
	"line_total" numeric(14, 2)
);
--> statement-breakpoint
CREATE TABLE "buyer_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"states" text[] DEFAULT '{}' NOT NULL,
	"counties" text[] DEFAULT '{}' NOT NULL,
	"zips" text[] DEFAULT '{}' NOT NULL,
	"property_types" text[] DEFAULT '{}' NOT NULL,
	"price_min" numeric(14, 2),
	"price_max" numeric(14, 2),
	"arv_pct_max" numeric(5, 4),
	"buying_formula" text,
	"condition_levels" integer[] DEFAULT '{}' NOT NULL,
	"occupancy_prefs" text[] DEFAULT '{}' NOT NULL,
	"funding" "funding" DEFAULT 'cash' NOT NULL,
	"proof_of_funds_on_file" boolean DEFAULT false NOT NULL,
	"sight_unseen" boolean DEFAULT false NOT NULL,
	"min_margin_amount" numeric(14, 2),
	"min_margin_pct" numeric(5, 4),
	"closes_in_days" integer
);
--> statement-breakpoint
CREATE TABLE "buyer_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"property_id" uuid,
	"address" text,
	"price" numeric(14, 2),
	"closed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "buyers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company" text,
	"first_name" text NOT NULL,
	"last_name" text,
	"phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"website" text,
	"source" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_contacted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deal_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"storage_path" text,
	"share_token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_by" uuid,
	CONSTRAINT "deal_packages_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "deal_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"package_id" uuid,
	"sent_at" timestamp with time zone,
	"sent_via" text,
	"response" "submission_response" DEFAULT 'none' NOT NULL,
	"response_amount" numeric(14, 2),
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_primary_contact_id_contacts_id_fk" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comps" ADD CONSTRAINT "comps_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comps" ADD CONSTRAINT "comps_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comps" ADD CONSTRAINT "comps_report_id_property_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."property_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_reports" ADD CONSTRAINT "property_reports_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_reports" ADD CONSTRAINT "property_reports_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_step_id_campaign_steps_id_fk" FOREIGN KEY ("campaign_step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_profiles_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_defaults" ADD CONSTRAINT "cost_defaults_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_analyses" ADD CONSTRAINT "deal_analyses_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_analyses" ADD CONSTRAINT "deal_analyses_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_analyses" ADD CONSTRAINT "deal_analyses_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_analyses" ADD CONSTRAINT "deal_analyses_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_line_items" ADD CONSTRAINT "rehab_line_items_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_line_items" ADD CONSTRAINT "rehab_line_items_analysis_id_deal_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."deal_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_criteria" ADD CONSTRAINT "buyer_criteria_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_criteria" ADD CONSTRAINT "buyer_criteria_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_purchases" ADD CONSTRAINT "buyer_purchases_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_purchases" ADD CONSTRAINT "buyer_purchases_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_purchases" ADD CONSTRAINT "buyer_purchases_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_packages" ADD CONSTRAINT "deal_packages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_packages" ADD CONSTRAINT "deal_packages_analysis_id_deal_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."deal_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_packages" ADD CONSTRAINT "deal_packages_generated_by_profiles_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_submissions" ADD CONSTRAINT "deal_submissions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_submissions" ADD CONSTRAINT "deal_submissions_analysis_id_deal_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."deal_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_submissions" ADD CONSTRAINT "deal_submissions_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_submissions" ADD CONSTRAINT "deal_submissions_package_id_deal_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."deal_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_at_idx" ON "audit_log" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "profiles_org_idx" ON "profiles" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contacts_org_idx" ON "contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contacts_name_idx" ON "contacts" USING btree ("org_id","last_name","first_name");--> statement-breakpoint
CREATE INDEX "properties_org_idx" ON "properties" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "properties_address_idx" ON "properties" USING btree ("org_id","state","city","address_line1");--> statement-breakpoint
CREATE UNIQUE INDEX "property_contacts_unique" ON "property_contacts" USING btree ("property_id","contact_id");--> statement-breakpoint
CREATE INDEX "activities_lead_time_idx" ON "activities" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "documents_lead_idx" ON "documents" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sources_org_name" ON "lead_sources" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_tags_unique" ON "lead_tags" USING btree ("lead_id","tag_id");--> statement-breakpoint
CREATE INDEX "leads_org_stage_idx" ON "leads" USING btree ("org_id","stage_id");--> statement-breakpoint
CREATE INDEX "leads_assigned_idx" ON "leads" USING btree ("org_id","assigned_to");--> statement-breakpoint
CREATE INDEX "leads_follow_up_idx" ON "leads" USING btree ("org_id","next_follow_up_at");--> statement-breakpoint
CREATE INDEX "leads_property_idx" ON "leads" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "offers_lead_idx" ON "offers" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_org_key" ON "pipeline_stages" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_kind_name" ON "tags" USING btree ("org_id","kind","name");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("org_id","assigned_to","due_at");--> statement-breakpoint
CREATE INDEX "comps_property_idx" ON "comps" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_reports_property_time_idx" ON "property_reports" USING btree ("property_id","fetched_at");--> statement-breakpoint
CREATE INDEX "campaign_enrollments_due_idx" ON "campaign_enrollments" USING btree ("status","next_send_at");--> statement-breakpoint
CREATE INDEX "campaign_steps_campaign_idx" ON "campaign_steps" USING btree ("campaign_id","position");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "messages_lead_time_idx" ON "messages" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_provider_id_idx" ON "messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_defaults_org_row" ON "cost_defaults" USING btree ("org_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_analyses_property_version" ON "deal_analyses" USING btree ("property_id","version");--> statement-breakpoint
CREATE INDEX "deal_analyses_lead_idx" ON "deal_analyses" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "deal_analyses_org_status_idx" ON "deal_analyses" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rehab_line_items_unique" ON "rehab_line_items" USING btree ("analysis_id","row_number");--> statement-breakpoint
CREATE INDEX "buyer_criteria_buyer_idx" ON "buyer_criteria" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "buyers_org_idx" ON "buyers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "deal_packages_analysis_idx" ON "deal_packages" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "deal_submissions_analysis_idx" ON "deal_submissions" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "deal_submissions_buyer_idx" ON "deal_submissions" USING btree ("buyer_id");