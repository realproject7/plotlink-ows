-- Add USD rate columns to trade_history for USD-denominated price charts.
-- reserve_usd_rate: the USD value of 1 reserve token (PLOT) at trade time.
-- rate_source: how the rate was obtained ('live', 'backfill_exact', 'backfill_approx').

alter table public.trade_history
  add column reserve_usd_rate numeric,
  add column rate_source text;

comment on column public.trade_history.reserve_usd_rate is
  'USD value of 1 reserve token (PLOT) at the time of this trade';
comment on column public.trade_history.rate_source is
  'How reserve_usd_rate was obtained: live | backfill_exact | backfill_approx';

alter table public.trade_history
  add constraint trade_history_rate_source_check
  check (rate_source in ('live', 'backfill_exact', 'backfill_approx'));
