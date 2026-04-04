-- Deduplicate plots rows with the same (storyline_id, plot_index), preferring
-- the row with the richest data (non-null title first, then latest id as tiebreaker).
-- Then add a unique constraint to prevent recurrence.
-- Finally re-reconcile plot_count from the deduplicated data.

-- Step 1: For each (storyline_id, plot_index) group, keep the best row:
-- prefer rows with a non-empty title, then the latest id as tiebreaker.
DELETE FROM plots
WHERE id NOT IN (
  SELECT DISTINCT ON (storyline_id, plot_index) id
  FROM plots
  ORDER BY storyline_id, plot_index,
    (COALESCE(title, '') != '') DESC,
    id DESC
);

-- Step 2: Add unique constraint to prevent future duplicates
ALTER TABLE plots
  ADD CONSTRAINT plots_storyline_plot_unique UNIQUE (storyline_id, plot_index);

-- Step 3: Re-reconcile plot_count and last_plot_time from deduplicated data
UPDATE storylines s
SET plot_count = sub.cnt,
    last_plot_time = sub.latest
FROM (
  SELECT storyline_id,
         COUNT(*) AS cnt,
         MAX(block_timestamp) AS latest
  FROM plots
  GROUP BY storyline_id
) sub
WHERE s.storyline_id = sub.storyline_id
  AND (s.plot_count IS DISTINCT FROM sub.cnt OR s.last_plot_time IS DISTINCT FROM sub.latest);
