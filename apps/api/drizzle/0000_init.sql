CREATE TYPE "public"."aspect_ratio" AS ENUM('16:9', '9:16', '1:1', '4:3', '2.39:1');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('style_ref', 'character_ref', 'location_ref', 'prop_ref', 'generated_output', 'cover');--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('email_password', 'google', 'apple');--> statement-breakpoint
CREATE TYPE "public"."camera_angle" AS ENUM('eye_level', 'low_angle', 'high_angle', 'birds_eye', 'worms_eye', 'dutch_tilt', 'overhead', 'profile', 'three_quarter');--> statement-breakpoint
CREATE TYPE "public"."character_role" AS ENUM('protagonist', 'antagonist', 'supporting', 'background', 'narrator');--> statement-breakpoint
CREATE TYPE "public"."continuity_target" AS ENUM('scene', 'shot', 'scene_pair', 'project');--> statement-breakpoint
CREATE TYPE "public"."depth_of_field" AS ENUM('deep_focus', 'shallow_bokeh', 'rack_focus', 'tilt_shift');--> statement-breakpoint
CREATE TYPE "public"."detector" AS ENUM('absent_speaker', 'costume_contradiction', 'bible_rule_violation', 'unestablished_prop', 'time_discontinuity', 'location_contradiction', 'style_drift', 'voice_drift');--> statement-breakpoint
CREATE TYPE "public"."editor_mode" AS ENUM('simple', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."episode_status" AS ENUM('outline', 'drafting', 'locked', 'exported');--> statement-breakpoint
CREATE TYPE "public"."export_format" AS ENUM('markdown', 'json', 'csv', 'pdf', 'txt_bundle');--> statement-breakpoint
CREATE TYPE "public"."export_scope" AS ENUM('episode', 'scene', 'shot_selection');--> statement-breakpoint
CREATE TYPE "public"."frame_rate_intent" AS ENUM('12fps_limited', '24fps', '30fps');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('not_started', 'exported', 'generated', 'approved', 'needs_rework');--> statement-breakpoint
CREATE TYPE "public"."interior_exterior" AS ENUM('INT', 'EXT', 'INT/EXT');--> statement-breakpoint
CREATE TYPE "public"."lens_focal_length" AS ENUM('ultra_wide_14mm', 'wide_24mm', 'normal_50mm', 'portrait_85mm', 'telephoto_135mm', 'macro');--> statement-breakpoint
CREATE TYPE "public"."lighting_preset" AS ENUM('natural_daylight', 'golden_hour', 'blue_hour', 'harsh_noon', 'overcast_soft', 'moonlight', 'candlelight', 'firelight', 'neon_night', 'single_key_dramatic', 'high_key', 'low_key', 'backlit_silhouette', 'rim_light', 'underlight_spooky', 'flat_cartoon', 'practical_source');--> statement-breakpoint
CREATE TYPE "public"."mood_atmosphere" AS ENUM('whimsical', 'tense', 'melancholy', 'triumphant', 'eerie', 'chaotic_comic', 'cosy', 'epic', 'dreamlike', 'mundane', 'menacing', 'bittersweet');--> statement-breakpoint
CREATE TYPE "public"."music_genre" AS ENUM('orchestral', 'jazz', 'chiptune', 'synthwave', 'folk_acoustic', 'rock', 'hip_hop', 'ambient', 'circus_polka', 'lullaby', 'marching_band', 'silence');--> statement-breakpoint
CREATE TYPE "public"."narration_style" AS ENUM('none', 'character_vo', 'omniscient_narrator');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'in_progress', 'complete', 'archived');--> statement-breakpoint
CREATE TYPE "public"."prop_significance" AS ENUM('plot_critical', 'running_gag', 'set_dressing');--> statement-breakpoint
CREATE TYPE "public"."proposal_scope" AS ENUM('tree', 'collection', 'record', 'field', 'advisory');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."shot_type" AS ENUM('extreme_wide', 'establishing', 'wide', 'full', 'medium_wide', 'medium', 'medium_close', 'close_up', 'extreme_close_up', 'over_the_shoulder', 'two_shot', 'point_of_view', 'insert', 'cutaway');--> statement-breakpoint
CREATE TYPE "public"."target_audience" AS ENUM('preschool', 'kids_6_11', 'tween', 'teen', 'adult', 'all_ages');--> statement-breakpoint
CREATE TYPE "public"."time_of_day" AS ENUM('dawn', 'morning', 'midday', 'afternoon', 'dusk', 'night', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."transition" AS ENUM('cut', 'fade_in', 'fade_out', 'dissolve', 'wipe', 'match_cut', 'smash_cut');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" text NOT NULL,
	"auth_provider" "auth_provider" DEFAULT 'email_password' NOT NULL,
	"password_hash" text,
	"default_editor_mode" "editor_mode" DEFAULT 'simple' NOT NULL,
	"is_minor" boolean DEFAULT false NOT NULL,
	"ai_credit_balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "ai_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid,
	"operation" text NOT NULL,
	"mode" "editor_mode" NOT NULL,
	"target_entity_type" text,
	"target_entity_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"latency_ms" integer,
	"accepted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"scope" "proposal_scope" NOT NULL,
	"target_entity_type" text,
	"target_entity_id" uuid,
	"payload" jsonb NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"revert_token" text,
	"revert_payload" jsonb,
	"ai_interaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_entity_type" text NOT NULL,
	"owner_entity_id" uuid,
	"kind" "asset_kind" NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"poster_asset_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" character_role DEFAULT 'supporting' NOT NULL,
	"prompt_token" text DEFAULT '' NOT NULL,
	"reference_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
	"openart_character_ref" text,
	"age_appearance" text DEFAULT '' NOT NULL,
	"physical_build" text DEFAULT '' NOT NULL,
	"distinguishing_features" text DEFAULT '' NOT NULL,
	"default_costume" text DEFAULT '' NOT NULL,
	"costume_variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"personality" text DEFAULT '' NOT NULL,
	"motivation" text DEFAULT '' NOT NULL,
	"speech_pattern" text DEFAULT '' NOT NULL,
	"voice_direction" text DEFAULT '' NOT NULL,
	"character_arc" text DEFAULT '' NOT NULL,
	"relationships" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "continuity_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid,
	"target_entity_type" "continuity_target" NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"secondary_entity_id" uuid,
	"detector" "detector" NOT NULL,
	"severity" "severity" DEFAULT 'warning' NOT NULL,
	"field" text,
	"message" text NOT NULL,
	"suggested_fix" text,
	"dedupe_hash" text NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_number" integer DEFAULT 1 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"logline" text DEFAULT '' NOT NULL,
	"synopsis" text DEFAULT '' NOT NULL,
	"target_duration_seconds" integer,
	"status" "episode_status" DEFAULT 'outline' NOT NULL,
	"raw_script" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid,
	"scope" "export_scope" NOT NULL,
	"format" "export_format" NOT NULL,
	"shot_count" integer DEFAULT 0 NOT NULL,
	"template_version" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prompt_token" text DEFAULT '' NOT NULL,
	"interior_exterior" "interior_exterior" DEFAULT 'INT' NOT NULL,
	"reference_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
	"default_time_of_day" time_of_day,
	"default_lighting" text DEFAULT '' NOT NULL,
	"ambient_sound" text DEFAULT '' NOT NULL,
	"set_dressing" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_cues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"genre" "music_genre" DEFAULT 'orchestral' NOT NULL,
	"tempo_bpm" integer,
	"mood" text DEFAULT '' NOT NULL,
	"instrumentation" text DEFAULT '' NOT NULL,
	"reference_track_note" text DEFAULT '' NOT NULL,
	"loopable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"title" text NOT NULL,
	"logline" text DEFAULT '' NOT NULL,
	"synopsis" text DEFAULT '' NOT NULL,
	"genre" text[] DEFAULT '{}' NOT NULL,
	"target_audience" "target_audience" DEFAULT 'kids_6_11' NOT NULL,
	"tone" text[] DEFAULT '{}' NOT NULL,
	"editor_mode" "editor_mode" DEFAULT 'simple' NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"cover_image_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "props" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prompt_token" text DEFAULT '' NOT NULL,
	"reference_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
	"significance" "prop_significance" DEFAULT 'set_dressing' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"scene_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"scene_number" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"slugline" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"location_id" uuid,
	"time_of_day" time_of_day DEFAULT 'unspecified' NOT NULL,
	"weather" text,
	"character_ids" uuid[] DEFAULT '{}' NOT NULL,
	"costume_overrides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scene_intent" text DEFAULT '' NOT NULL,
	"emotional_beat" text DEFAULT '' NOT NULL,
	"synopsis" text DEFAULT '' NOT NULL,
	"action_description" text DEFAULT '' NOT NULL,
	"scenery_description" text DEFAULT '' NOT NULL,
	"lighting" text DEFAULT '' NOT NULL,
	"lighting_preset" "lighting_preset",
	"mood_atmosphere" "mood_atmosphere",
	"style_override" text,
	"music_cue_id" uuid,
	"music_direction" text DEFAULT '' NOT NULL,
	"sfx" text[] DEFAULT '{}' NOT NULL,
	"script_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_duration_seconds" integer,
	"transition_in" "transition" DEFAULT 'cut' NOT NULL,
	"transition_out" "transition" DEFAULT 'cut' NOT NULL,
	"director_notes" text DEFAULT '' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_bibles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"art_style" text DEFAULT '' NOT NULL,
	"style_reference_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
	"colour_palette" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"line_treatment" text DEFAULT '' NOT NULL,
	"render_quality_tokens" text DEFAULT '' NOT NULL,
	"negative_prompt" text DEFAULT '' NOT NULL,
	"aspect_ratio" "aspect_ratio" DEFAULT '16:9' NOT NULL,
	"resolution_target" text DEFAULT '' NOT NULL,
	"frame_rate_intent" "frame_rate_intent" DEFAULT '24fps' NOT NULL,
	"default_lighting" text DEFAULT '' NOT NULL,
	"music_genre" text DEFAULT '' NOT NULL,
	"music_instrumentation" text DEFAULT '' NOT NULL,
	"sound_design_notes" text DEFAULT '' NOT NULL,
	"narration_style" "narration_style" DEFAULT 'none' NOT NULL,
	"continuity_rules" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "series_bibles_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"scene_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"shot_number" text DEFAULT '1' NOT NULL,
	"export_key" text NOT NULL,
	"shot_type" "shot_type" DEFAULT 'medium' NOT NULL,
	"camera_angle" "camera_angle" DEFAULT 'eye_level' NOT NULL,
	"lens_focal_length" "lens_focal_length" DEFAULT 'normal_50mm' NOT NULL,
	"depth_of_field" "depth_of_field" DEFAULT 'deep_focus' NOT NULL,
	"subject_character_ids" uuid[] DEFAULT '{}' NOT NULL,
	"subject_placement" text DEFAULT '' NOT NULL,
	"action_beat" text DEFAULT '' NOT NULL,
	"expression_note" text DEFAULT '' NOT NULL,
	"visible_props" uuid[] DEFAULT '{}' NOT NULL,
	"lighting_override" text,
	"duration_seconds" numeric(6, 2),
	"compiled_prompt" text DEFAULT '' NOT NULL,
	"compiled_negative_prompt" text DEFAULT '' NOT NULL,
	"prompt_template_version" text DEFAULT 'v1' NOT NULL,
	"generation_status" "generation_status" DEFAULT 'not_started' NOT NULL,
	"generated_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
	"hero_asset_id" uuid,
	"rework_note" text,
	"user_prompt_addendum" text DEFAULT '' NOT NULL,
	"prompt_locked" boolean DEFAULT false NOT NULL,
	"ai_default_unreviewed" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unmatched_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid,
	"asset_id" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_shot_id" uuid
);
--> statement-breakpoint
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_ai_interaction_id_ai_interactions_id_fk" FOREIGN KEY ("ai_interaction_id") REFERENCES "public"."ai_interactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity_flags" ADD CONSTRAINT "continuity_flags_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity_flags" ADD CONSTRAINT "continuity_flags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity_flags" ADD CONSTRAINT "continuity_flags_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_packs" ADD CONSTRAINT "export_packs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_packs" ADD CONSTRAINT "export_packs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_packs" ADD CONSTRAINT "export_packs_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_cues" ADD CONSTRAINT "music_cues_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_cues" ADD CONSTRAINT "music_cues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "props" ADD CONSTRAINT "props_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "props" ADD CONSTRAINT "props_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_versions" ADD CONSTRAINT "scene_versions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_versions" ADD CONSTRAINT "scene_versions_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_music_cue_id_music_cues_id_fk" FOREIGN KEY ("music_cue_id") REFERENCES "public"."music_cues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_bibles" ADD CONSTRAINT "series_bibles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_bibles" ADD CONSTRAINT "series_bibles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_uploads" ADD CONSTRAINT "unmatched_uploads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_uploads" ADD CONSTRAINT "unmatched_uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_uploads" ADD CONSTRAINT "unmatched_uploads_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_uploads" ADD CONSTRAINT "unmatched_uploads_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_uploads" ADD CONSTRAINT "unmatched_uploads_assigned_shot_id_shots_id_fk" FOREIGN KEY ("assigned_shot_id") REFERENCES "public"."shots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_project_idx" ON "assets" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "characters_project_idx" ON "characters" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "continuity_flags_project_idx" ON "continuity_flags" USING btree ("project_id","dismissed");--> statement-breakpoint
CREATE UNIQUE INDEX "continuity_flags_dedupe_unique" ON "continuity_flags" USING btree ("project_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "episodes_project_idx" ON "episodes" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX "locations_project_idx" ON "locations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "music_cues_project_idx" ON "music_cues" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_account_idx" ON "projects" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "props_project_idx" ON "props" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scene_versions_unique" ON "scene_versions" USING btree ("scene_id","version");--> statement-breakpoint
CREATE INDEX "scenes_episode_idx" ON "scenes" USING btree ("episode_id","sort_order");--> statement-breakpoint
CREATE INDEX "scenes_character_ids_idx" ON "scenes" USING gin ("character_ids");--> statement-breakpoint
CREATE INDEX "shots_scene_idx" ON "shots" USING btree ("scene_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "shots_export_key_unique" ON "shots" USING btree ("project_id","export_key");--> statement-breakpoint
CREATE INDEX "shots_subject_character_ids_idx" ON "shots" USING gin ("subject_character_ids");