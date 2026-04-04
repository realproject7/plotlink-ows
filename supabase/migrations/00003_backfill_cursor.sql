-- Persistent cursor for cron backfill — tracks last processed block.
create table if not exists backfill_cursor (
  id integer primary key default 1 check (id = 1), -- singleton row
  last_block bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Seed the singleton row
insert into backfill_cursor (id, last_block) values (1, 0)
  on conflict (id) do nothing;
