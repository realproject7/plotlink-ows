-- Reconcile stale storylines.plot_count and last_plot_time from plots table.
-- Idempotent: only updates rows where values differ from computed aggregates.
-- Context: PR #258 fixed the code path; this migration fixes existing stale data.

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
