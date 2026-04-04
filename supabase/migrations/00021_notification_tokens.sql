-- [#489] Notification tokens for Farcaster miniapp push notifications
CREATE TABLE IF NOT EXISTS notification_tokens (
  fid            INTEGER PRIMARY KEY,
  notification_token TEXT NOT NULL,
  notification_url   TEXT NOT NULL,
  client_app_fid     INTEGER,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_tokens_enabled
  ON notification_tokens (enabled) WHERE enabled = TRUE;
