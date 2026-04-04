-- Fix ratings unique constraint to include contract_address for multi-contract upsert
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_storyline_id_rater_address_key;
ALTER TABLE ratings ADD CONSTRAINT ratings_storyline_id_rater_address_contract_address_key
  UNIQUE (storyline_id, rater_address, contract_address);

-- Update increment_view_count RPC to scope by contract_address
CREATE OR REPLACE FUNCTION increment_view_count(sid INTEGER, caddr TEXT)
RETURNS void AS $$
BEGIN
  UPDATE storylines
    SET view_count = view_count + 1
    WHERE storyline_id = sid AND contract_address = caddr;
END;
$$ LANGUAGE plpgsql;

-- Performance indexes on contract_address for filtered queries
CREATE INDEX idx_storylines_contract ON storylines (contract_address);
CREATE INDEX idx_plots_contract ON plots (contract_address);
CREATE INDEX idx_donations_contract ON donations (contract_address);
CREATE INDEX idx_ratings_contract ON ratings (contract_address);
CREATE INDEX idx_comments_contract ON comments (contract_address);
CREATE INDEX idx_page_views_contract ON page_views (contract_address);
