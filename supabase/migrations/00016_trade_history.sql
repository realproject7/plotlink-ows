create table if not exists public.trade_history (
  id bigint generated always as identity primary key,
  token_address text not null,
  storyline_id bigint not null,
  event_type text not null,
  price_per_token numeric not null,
  total_supply numeric not null,
  reserve_amount numeric not null,
  block_number bigint not null,
  block_timestamp timestamptz not null,
  tx_hash text not null,
  log_index integer not null,
  contract_address text not null,
  unique (tx_hash, log_index)
);

create index idx_trade_history_token_ts on public.trade_history (token_address, block_timestamp);
create index idx_trade_history_storyline on public.trade_history (storyline_id);
