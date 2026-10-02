-- The starting pot (0013) was one month's budget, but the pot counts spending from all time, so an
-- account that had spent in earlier months woke up short by exactly that earlier spending. Put that
-- amount back, once, for every account that received a starting pot, so the pot after this step is
-- what the old monthly cap would have allowed: the month's budget minus this month's spending.
-- Nothing is charged and no generation runs.
INSERT INTO "credit_top_ups" ("account_id", "added_by_account_id", "pence", "note")
SELECT t."account_id", NULL, s."earlier", 'Starting pot correction (spending from earlier months)'
FROM "credit_top_ups" t
JOIN (
  SELECT "account_id",
         COALESCE(SUM(CASE WHEN "created_at" < date_trunc('month', now() AT TIME ZONE 'UTC') THEN COALESCE("actual_pence", "estimated_pence") END), 0)::int AS "earlier"
  FROM "generation_ledger"
  WHERE "status" IN ('reserved', 'settled')
  GROUP BY "account_id"
) s ON s."account_id" = t."account_id"
WHERE t."note" = 'Starting pot (moved from the monthly budget)'
  AND s."earlier" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "credit_top_ups" c
    WHERE c."account_id" = t."account_id" AND c."note" = 'Starting pot correction (spending from earlier months)'
  );
