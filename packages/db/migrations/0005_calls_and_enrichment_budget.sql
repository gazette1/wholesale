CREATE TYPE "public"."call_status" AS ENUM('queued', 'ringing', 'in_progress', 'completed', 'busy', 'no_answer', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "enrichment_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"auto_enrich_on_create" boolean DEFAULT false NOT NULL,
	"per_lead_cap_cents" integer DEFAULT 100 NOT NULL,
	"monthly_budget_cents" integer DEFAULT 5000 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid,
	"contact_id" uuid,
	"direction" "direction" NOT NULL,
	"from_addr" text NOT NULL,
	"to_addr" text NOT NULL,
	"provider" text NOT NULL,
	"provider_call_id" text,
	"status" "call_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"recording_url" text,
	"outcome" text,
	"notes" text,
	"placed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "enrichment_settings" ADD CONSTRAINT "enrichment_settings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_placed_by_profiles_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrichment_settings_org" ON "enrichment_settings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "calls_lead_time_idx" ON "calls" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "calls_provider_id_idx" ON "calls" USING btree ("provider_call_id");