ALTER TYPE "public"."character_source" ADD VALUE 'library';--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "source_character_id" uuid;