CREATE TYPE "public"."candidate_source" AS ENUM('generated', 'upload', 'refinement', 'legacy');--> statement-breakpoint
CREATE TYPE "public"."candidate_status" AS ENUM('candidate', 'removed');--> statement-breakpoint
CREATE TYPE "public"."cost_state" AS ENUM('estimated', 'actual', 'unknown', 'not_incurred');--> statement-breakpoint
CREATE TYPE "public"."generation_intent" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TYPE "public"."reference_view" AS ENUM('main', 'front', 'three_quarter', 'side', 'back', 'full_body', 'expression');--> statement-breakpoint
CREATE TYPE "public"."submission_state" AS ENUM('not_submitted', 'submitting', 'accepted', 'uncertain');--> statement-breakpoint
ALTER TYPE "public"."asset_kind" ADD VALUE 'frame_ref';--> statement-breakpoint
CREATE TABLE "character_reference_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"view_role" "reference_view" DEFAULT 'main' NOT NULL,
	"source" "candidate_source" NOT NULL,
	"source_visual_version_id" uuid,
	"parent_candidate_id" uuid,
	"generation_job_id" uuid,
	"status" "candidate_status" DEFAULT 'candidate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_visual_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"visual_version_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"content_sha256" text NOT NULL,
	"role" "reference_view" NOT NULL,
	"position" integer NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_visual_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"visual_version" integer NOT NULL,
	"traits" jsonb NOT NULL,
	"art_style" text DEFAULT '' NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shot_character_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"shot_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"visual_version_id" uuid,
	"outfit_label" text,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "content_sha256" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "current_visual_version_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "species" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "colours" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "look_outdated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "story_suggestion" text;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "task" text;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "intent" "generation_intent";--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "generation_group_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "parent_job_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "snapshot_version" integer;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "submission_state" "submission_state" DEFAULT 'not_submitted' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "next_poll_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "provider_result" jsonb;--> statement-breakpoint
ALTER TABLE "generation_ledger" ADD COLUMN "cost_state" "cost_state" DEFAULT 'estimated' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_ledger" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "start_frame_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "end_frame_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "character_reference_candidates" ADD CONSTRAINT "character_reference_candidates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_reference_candidates" ADD CONSTRAINT "character_reference_candidates_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_reference_candidates" ADD CONSTRAINT "character_reference_candidates_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_visual_references" ADD CONSTRAINT "character_visual_references_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_visual_references" ADD CONSTRAINT "character_visual_references_visual_version_id_character_visual_versions_id_fk" FOREIGN KEY ("visual_version_id") REFERENCES "public"."character_visual_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_visual_references" ADD CONSTRAINT "character_visual_references_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_visual_versions" ADD CONSTRAINT "character_visual_versions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_visual_versions" ADD CONSTRAINT "character_visual_versions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_character_bindings" ADD CONSTRAINT "shot_character_bindings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_character_bindings" ADD CONSTRAINT "shot_character_bindings_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_character_bindings" ADD CONSTRAINT "shot_character_bindings_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_character_bindings" ADD CONSTRAINT "shot_character_bindings_visual_version_id_character_visual_versions_id_fk" FOREIGN KEY ("visual_version_id") REFERENCES "public"."character_visual_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_reference_candidates_character_idx" ON "character_reference_candidates" USING btree ("character_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "character_reference_candidates_asset_unique" ON "character_reference_candidates" USING btree ("character_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_visual_references_position" ON "character_visual_references" USING btree ("visual_version_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "character_visual_versions_unique" ON "character_visual_versions" USING btree ("character_id","visual_version");--> statement-breakpoint
CREATE UNIQUE INDEX "shot_character_bindings_unique" ON "shot_character_bindings" USING btree ("shot_id","character_id");--> statement-breakpoint
CREATE INDEX "shot_character_bindings_shot_idx" ON "shot_character_bindings" USING btree ("shot_id","position");--> statement-breakpoint
CREATE INDEX "generation_jobs_group_idx" ON "generation_jobs" USING btree ("generation_group_id");