-- Index for durable session-based rate limiting on page_views
CREATE INDEX IF NOT EXISTS idx_page_views_session_rate
  ON page_views(session_id, viewed_at);
