CREATE INDEX "ai_interactions_account_op_idx" ON "ai_interactions" USING btree ("account_id","operation","created_at");--> statement-breakpoint
CREATE INDEX "ai_proposals_target_idx" ON "ai_proposals" USING btree ("account_id","target_entity_id","operation","status");--> statement-breakpoint
CREATE INDEX "generation_jobs_project_idx" ON "generation_jobs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_account_idx" ON "generation_jobs" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "scenes_project_idx" ON "scenes" USING btree ("project_id","sort_order");