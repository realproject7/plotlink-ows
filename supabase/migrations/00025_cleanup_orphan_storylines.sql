-- [#549] Clean up orphan storylines 25-33 from first E2E attempt
-- and reset backfill cursor for the v4b factory redeployment.
--
-- Storylines 25-33 were created on the v4b factory
-- (0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf) during the first E2E
-- attempt with wrong content hashes. They need to be removed so the
-- backfill can re-index clean data from the same factory.

-- Scope all deletes to the v4b factory to avoid touching data from
-- any other contract.

-- 1. Delete plots for orphan storylines on v4b factory
DELETE FROM plots
  WHERE storyline_id BETWEEN 25 AND 33
    AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 2. Delete donations for orphan storylines on v4b factory
DELETE FROM donations
  WHERE storyline_id BETWEEN 25 AND 33
    AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 3. Delete ratings for orphan storylines on v4b factory
DELETE FROM ratings
  WHERE storyline_id BETWEEN 25 AND 33
    AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 4. Delete comments for orphan storylines on v4b factory
DELETE FROM comments
  WHERE storyline_id BETWEEN 25 AND 33
    AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 5. Delete page views for orphan storylines on v4b factory
DELETE FROM page_views
  WHERE storyline_id BETWEEN 25 AND 33
    AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 6. Delete trade history for orphan storylines
DELETE FROM trade_history WHERE storyline_id BETWEEN 25 AND 33;

-- 7. Delete the orphan storylines on v4b factory (last, after FK-dependent deletes)
DELETE FROM storylines
  WHERE storyline_id BETWEEN 25 AND 33
    AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 8. Clean up backfill_failures for orphan storylines
DELETE FROM backfill_failures WHERE storyline_id BETWEEN 25 AND 33;

-- 9. Clean up notification_queue for orphan storylines (skip if table doesn't exist)
DO $$ BEGIN
  DELETE FROM notification_queue WHERE storyline_id BETWEEN 25 AND 33;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 10. Reset backfill cursor to just before the v4b factory deployment block
-- so the backfill picks up events from the new factory (deployed at 43840298)
UPDATE backfill_cursor SET last_block = 43840297 WHERE id = 1;
UPDATE backfill_cursor SET last_block = 43840297 WHERE id = 2;
