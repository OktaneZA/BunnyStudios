-- CS-12: existing character pictures become legacy candidates awaiting identity confirmation.
-- Nothing is approved here: characters.current_visual_version_id stays null, so no visual
-- revision is invented from an old "main picture" choice. The old main picture is marked as the
-- main-view candidate so Studio can offer it first. No paid generation runs.
INSERT INTO "character_reference_candidates" ("account_id", "character_id", "asset_id", "view_role", "source", "status", "created_at")
SELECT a."account_id", c."id", a."id",
       CASE WHEN c."main_reference_asset_id" = a."id" THEN 'main'::"reference_view" ELSE 'front'::"reference_view" END,
       'legacy'::"candidate_source", 'candidate'::"candidate_status", a."uploaded_at"
FROM "assets" a
JOIN "characters" c ON c."id" = a."owner_entity_id" AND c."account_id" = a."account_id"
WHERE a."owner_entity_type" = 'character' AND a."kind" = 'character_ref' AND a."deleted_at" IS NULL
ON CONFLICT DO NOTHING;
