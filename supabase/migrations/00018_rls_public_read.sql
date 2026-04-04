-- trade_history: public read for price charts
create policy "Public read" on public.trade_history for select using (true);

-- backfill_failures: public read for diagnostics
create policy "Public read" on public.backfill_failures for select using (true);

-- backfill_cursor: public read for status checks
create policy "Public read" on public.backfill_cursor for select using (true);
