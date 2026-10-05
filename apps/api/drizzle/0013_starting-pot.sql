-- Pre-paid picture money replaces the monthly cap. Every existing account starts with a pot equal
-- to its old monthly budget, so nothing that worked yesterday stops working today. Money already
-- spent keeps counting against that pot through the ledger, exactly as it counted against the
-- month. Nothing is charged and no generation runs.
INSERT INTO "credit_top_ups" ("account_id", "added_by_account_id", "pence", "note")
SELECT "id", NULL, "monthly_budget_pence", 'Starting pot (moved from the monthly budget)'
FROM "accounts"
WHERE "monthly_budget_pence" > 0;
