-- Allow multiple cursor rows (one per cron job) by dropping the id=1 check.
alter table backfill_cursor drop constraint if exists backfill_cursor_id_check;

-- Seed trade-history cursor (id=2)
insert into backfill_cursor (id, last_block) values (2, 0)
  on conflict (id) do nothing;
