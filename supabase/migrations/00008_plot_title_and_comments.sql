-- Add title column to plots
ALTER TABLE plots ADD COLUMN title TEXT NOT NULL DEFAULT '';

-- Comments table
CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  storyline_id INTEGER NOT NULL REFERENCES storylines(storyline_id),
  plot_index INTEGER NOT NULL,
  commenter_address TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hidden BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_comments_plot ON comments(storyline_id, plot_index);
CREATE INDEX idx_comments_commenter ON comments(commenter_address);

-- RLS: public read (non-hidden), service-role insert
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read comments"
  ON comments FOR SELECT
  USING (hidden = false);
