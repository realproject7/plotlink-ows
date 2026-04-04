-- Ratings table: one rating per user per storyline (upsert pattern)
-- Public read, no public write (writes via service role only)

CREATE TABLE ratings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  storyline_id BIGINT NOT NULL REFERENCES storylines(storyline_id),
  rater_address TEXT NOT NULL,
  rating      SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (storyline_id, rater_address)
);

CREATE INDEX idx_ratings_storyline ON ratings (storyline_id);

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON ratings FOR SELECT USING (true);
