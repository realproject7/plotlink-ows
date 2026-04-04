-- [#543] Clean up all data from previous factory contracts (pre-PLOT token era)
--
-- The new StoryFactory v4 (J-curve + real PLOT) is at:
--   0x92c3bd44fda84e632c3c3cb31387d0c0c1de618d
--
-- Old contracts to remove:
--   0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d (v1)
--   0x05c4d59529807316d6fa09cdaa509addfe85b474 (v2 Sepolia)
--   0x337c5b96f03fb335b433291695a4171fd5ded8b0 (v3 mainnet, PL_TEST)
--
-- trade_history uses MCV2_Bond address, not factory address.
-- All old trades were against old storyline tokens backed by PL_TEST,
-- so we delete trade_history rows for storyline_ids that no longer exist.

-- 1. Delete plots from old factories
DELETE FROM plots
  WHERE lower(contract_address) != lower('0x92c3bd44fda84e632c3c3cb31387d0c0c1de618d');

-- 2. Delete donations from old factories
DELETE FROM donations
  WHERE lower(contract_address) != lower('0x92c3bd44fda84e632c3c3cb31387d0c0c1de618d');

-- 3. Delete ratings from old factories
DELETE FROM ratings
  WHERE lower(contract_address) != lower('0x92c3bd44fda84e632c3c3cb31387d0c0c1de618d');

-- 4. Delete comments from old factories
DELETE FROM comments
  WHERE lower(contract_address) != lower('0x92c3bd44fda84e632c3c3cb31387d0c0c1de618d');

-- 5. Delete page views from old factories
DELETE FROM page_views
  WHERE lower(contract_address) != lower('0x92c3bd44fda84e632c3c3cb31387d0c0c1de618d');

-- 6. Delete trade history for old storylines
--    (trade_history.contract_address = MCV2_Bond, not factory,
--     so we delete by storyline_id not matching any current storyline)
DELETE FROM trade_history
  WHERE storyline_id NOT IN (
    SELECT storyline_id FROM storylines
    WHERE lower(contract_address) = lower('0x92c3bd44fda84e632c3c3cb31387d0c0c1de618d')
  );

-- 7. Delete storylines from old factories (last, after FK-dependent deletes)
DELETE FROM storylines
  WHERE lower(contract_address) != lower('0x92c3bd44fda84e632c3c3cb31387d0c0c1de618d');

-- 8. Clean up backfill_failures for old storylines
DELETE FROM backfill_failures
  WHERE storyline_id NOT IN (
    SELECT storyline_id FROM storylines
  );

-- 9. Clean up notification_queue for old storylines (skip if table doesn't exist)
DO $$ BEGIN
  DELETE FROM notification_queue
    WHERE storyline_id IS NOT NULL
      AND storyline_id NOT IN (SELECT storyline_id FROM storylines);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 10. Clean up token_price_snapshots for old tokens (skip if table doesn't exist)
DO $$ BEGIN
  DELETE FROM token_price_snapshots
    WHERE lower(token_address) NOT IN (
      SELECT lower(token_address) FROM storylines WHERE token_address IS NOT NULL
    );
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
