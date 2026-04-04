-- [#521] Targeted notifications for token holders
--
-- 1. Add wallet_address to notification_tokens (links FID → wallet for on-chain lookups)
-- 2. Create notification_queue for batched, targeted delivery
-- 3. Create token_price_snapshots for price change detection

-- 1. wallet_address on notification_tokens
ALTER TABLE notification_tokens
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;

CREATE INDEX IF NOT EXISTS idx_notification_tokens_wallet
  ON notification_tokens (wallet_address)
  WHERE wallet_address IS NOT NULL;

-- 2. Notification queue
CREATE TABLE IF NOT EXISTS notification_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_fid      INTEGER NOT NULL,
  notification_type TEXT NOT NULL,
  storyline_id    BIGINT,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  target_url      TEXT NOT NULL,
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error_message   TEXT,
  scheduled_at    TIMESTAMPTZ DEFAULT NOW(),
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_queue_status
  ON notification_queue (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_notification_queue_dedup
  ON notification_queue (target_fid, notification_type, storyline_id)
  WHERE status = 'pending';

-- 3. Token price snapshots (for >10% change alerts)
CREATE TABLE IF NOT EXISTS token_price_snapshots (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_address   TEXT NOT NULL,
  price           NUMERIC NOT NULL,
  snapshot_time   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_token_time
  ON token_price_snapshots (token_address, snapshot_time DESC);
