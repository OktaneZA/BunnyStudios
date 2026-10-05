CREATE TABLE "credit_top_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"added_by_account_id" uuid,
	"pence" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_top_ups" ADD CONSTRAINT "credit_top_ups_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_top_ups" ADD CONSTRAINT "credit_top_ups_added_by_account_id_accounts_id_fk" FOREIGN KEY ("added_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_top_ups_account_idx" ON "credit_top_ups" USING btree ("account_id","created_at");