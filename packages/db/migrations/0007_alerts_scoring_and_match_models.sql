CREATE TYPE "public"."alert_kind" AS ENUM('lead_untouched', 'follow_up_overdue', 'offer_expiring');--> statement-breakpoint
CREATE TYPE "public"."score_review_status" AS ENUM('auto_applied', 'suggested', 'needs_review', 'accepted', 'overridden');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid,
	"recipient_id" uuid,
	"kind" "alert_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"review_status" "score_review_status" DEFAULT 'needs_review' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"override_score" integer
);
--> statement-breakpoint
CREATE TABLE "buyer_match_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explanations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"trained_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_submissions" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "deal_submissions" ADD COLUMN "first_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_submissions" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_recipient_id_profiles_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_match_models" ADD CONSTRAINT "buyer_match_models_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_org_dedupe" ON "alerts" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "alerts_recipient_idx" ON "alerts" USING btree ("org_id","recipient_id","read_at");--> statement-breakpoint
CREATE INDEX "alerts_lead_idx" ON "alerts" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_scores_lead_idx" ON "lead_scores" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_scores_review_idx" ON "lead_scores" USING btree ("org_id","review_status");--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_match_models_org" ON "buyer_match_models" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "offers_expires_idx" ON "offers" USING btree ("org_id","expires_at");--> statement-breakpoint
ALTER TABLE "deal_submissions" ADD CONSTRAINT "deal_submissions_token_unique" UNIQUE("token");