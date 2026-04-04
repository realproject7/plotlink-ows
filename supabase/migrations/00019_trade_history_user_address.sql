-- Add user_address column to trade_history for filtering by trader
ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS user_address text;

-- Index for reader dashboard queries
CREATE INDEX IF NOT EXISTS idx_trade_history_user_address
  ON trade_history (user_address, block_timestamp DESC);
