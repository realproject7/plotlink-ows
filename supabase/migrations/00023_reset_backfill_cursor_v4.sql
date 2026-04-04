-- [#539] Reset backfill_cursor for StoryFactory v4 (J-curve + real PLOT)
-- New contract deployed at block 43824790
-- Old cursor may be past this block, so reset to pick up new factory events
UPDATE backfill_cursor SET last_block = 43824789 WHERE id = 1;
UPDATE backfill_cursor SET last_block = 43824789 WHERE id = 2;
