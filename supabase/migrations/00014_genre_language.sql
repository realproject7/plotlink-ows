-- Add genre and language metadata to storylines.
-- genre: nullable (existing storylines = uncategorized)
-- language: defaults to 'English'

ALTER TABLE storylines
  ADD COLUMN genre text,
  ADD COLUMN language text NOT NULL DEFAULT 'English';

CREATE INDEX idx_storylines_genre ON storylines (genre);
CREATE INDEX idx_storylines_language ON storylines (language);
