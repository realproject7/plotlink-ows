-- Add denormalized view_count to storylines
ALTER TABLE storylines ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;

-- page_views table for granular tracking
CREATE TABLE page_views (
  id SERIAL PRIMARY KEY,
  storyline_id INTEGER NOT NULL REFERENCES storylines(storyline_id),
  plot_index INTEGER,           -- NULL = storyline page, 0 = genesis, 1+ = chapter
  viewer_address TEXT,          -- NULL for anonymous views
  session_id TEXT NOT NULL,     -- fingerprint for session dedup
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_page_views_storyline ON page_views(storyline_id);
CREATE INDEX idx_page_views_plot ON page_views(storyline_id, plot_index);
CREATE INDEX idx_page_views_dedup ON page_views(storyline_id, plot_index, session_id, viewed_at);

-- RLS: public read, service-role insert (API route uses service role)
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read page_views"
  ON page_views FOR SELECT
  USING (true);

-- Atomic increment function for view_count
CREATE OR REPLACE FUNCTION increment_view_count(sid INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE storylines SET view_count = view_count + 1 WHERE storyline_id = sid;
END;
$$ LANGUAGE plpgsql;
