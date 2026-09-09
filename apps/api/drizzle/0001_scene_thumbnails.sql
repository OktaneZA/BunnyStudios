ALTER TYPE "public"."asset_kind" ADD VALUE 'scene_thumbnail';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "thumbnail_svg" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "thumbnail_description" text;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "thumbnail_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "thumbnail_source_fingerprint" text;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "thumbnail_revision" integer DEFAULT 0 NOT NULL;