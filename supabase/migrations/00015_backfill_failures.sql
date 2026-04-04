create table if not exists public.backfill_failures (
  id bigint generated always as identity primary key,
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  event_name text not null,
  storyline_id bigint not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index idx_backfill_failures_storyline on public.backfill_failures (storyline_id);
