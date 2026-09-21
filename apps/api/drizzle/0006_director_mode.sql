CREATE TYPE "public"."character_source" AS ENUM('manual', 'story');--> statement-breakpoint
CREATE TYPE "public"."generation_job_kind" AS ENUM('image', 'video', 'render');--> statement-breakpoint
CREATE TYPE "public"."generation_job_status" AS ENUM('queued', 'submitted', 'running', 'reviewing', 'ready', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ledger_status" AS ENUM('reserved', 'settled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('not_required', 'pending', 'allowed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."transition_out" AS ENUM('cut', 'fade', 'slide');--> statement-breakpoint
ALTER TYPE "public"."asset_kind" ADD VALUE 'final_render';--> statement-breakpoint
ALTER TYPE "public"."asset_kind" ADD VALUE 'music';--> statement-breakpoint
ALTER TYPE "public"."asset_kind" ADD VALUE 'voiceover';--> statement-breakpoint
ALTER TYPE "public"."asset_kind" ADD VALUE 'poster';--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"kind" "generation_job_kind" NOT NULL,
	"target_entity_type" text NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_job_id" text,
	"request" jsonb NOT NULL,
	"status" "generation_job_status" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"error_code" text,
	"error_detail" text,
	"result_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "generation_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"units" integer NOT NULL,
	"unit_cost_pence" numeric(8, 3) NOT NULL,
	"estimated_pence" integer NOT NULL,
	"actual_pence" integer,
	"currency" varchar(3) DEFAULT 'GBP' NOT NULL,
	"status" "ledger_status" DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"timeline_id" uuid NOT NULL,
	"scene_id" uuid NOT NULL,
	"shot_id" uuid,
	"asset_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"trim_in_ms" integer DEFAULT 0 NOT NULL,
	"trim_out_ms" integer,
	"transition_out" "transition_out" DEFAULT 'fade' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "timeline_voiceovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"timeline_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"start_ms" integer DEFAULT 0 NOT NULL,
	"volume" integer DEFAULT 100 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "timelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"hand_edited" boolean DEFAULT false NOT NULL,
	"music_asset_id" uuid,
	"music_volume" integer DEFAULT 70 NOT NULL,
	"music_fade_in_ms" integer DEFAULT 0 NOT NULL,
	"music_fade_out_ms" integer DEFAULT 1500 NOT NULL,
	"render_asset_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timelines_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "daily_budget_pence" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "monthly_budget_pence" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "currency" varchar(3) DEFAULT 'GBP' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "review_status" "review_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "generation_job_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "source" character_source DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "found_in_scene_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "description_fingerprint" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "main_reference_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "background_story" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "hero_video_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_ledger" ADD CONSTRAINT "generation_ledger_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_ledger" ADD CONSTRAINT "generation_ledger_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_ledger" ADD CONSTRAINT "generation_ledger_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_items" ADD CONSTRAINT "timeline_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_items" ADD CONSTRAINT "timeline_items_timeline_id_timelines_id_fk" FOREIGN KEY ("timeline_id") REFERENCES "public"."timelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_items" ADD CONSTRAINT "timeline_items_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_voiceovers" ADD CONSTRAINT "timeline_voiceovers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_voiceovers" ADD CONSTRAINT "timeline_voiceovers_timeline_id_timelines_id_fk" FOREIGN KEY ("timeline_id") REFERENCES "public"."timelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timelines" ADD CONSTRAINT "timelines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timelines" ADD CONSTRAINT "timelines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_request_key" ON "generation_jobs" USING btree ("account_id","request_key");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_target_idx" ON "generation_jobs" USING btree ("target_entity_type","target_entity_id");--> statement-breakpoint
CREATE INDEX "generation_ledger_account_day_idx" ON "generation_ledger" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "timeline_items_timeline_idx" ON "timeline_items" USING btree ("timeline_id","sort_order");--> statement-breakpoint
CREATE INDEX "timeline_voiceovers_timeline_idx" ON "timeline_voiceovers" USING btree ("timeline_id","start_ms");--> statement-breakpoint
CREATE INDEX "assets_owner_idx" ON "assets" USING btree ("owner_entity_type","owner_entity_id");