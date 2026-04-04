-- Add contract_address to all tables for multi-contract support
-- Default existing rows to old contract address (lowercase)

ALTER TABLE storylines ADD COLUMN contract_address TEXT NOT NULL DEFAULT '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d';
ALTER TABLE plots ADD COLUMN contract_address TEXT NOT NULL DEFAULT '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d';
ALTER TABLE donations ADD COLUMN contract_address TEXT NOT NULL DEFAULT '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d';
ALTER TABLE ratings ADD COLUMN contract_address TEXT NOT NULL DEFAULT '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d';
ALTER TABLE comments ADD COLUMN contract_address TEXT NOT NULL DEFAULT '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d';
ALTER TABLE page_views ADD COLUMN contract_address TEXT NOT NULL DEFAULT '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d';

-- After backfilling existing rows, change default to empty string
-- Indexers will always explicitly pass the value
ALTER TABLE storylines ALTER COLUMN contract_address SET DEFAULT '';
ALTER TABLE plots ALTER COLUMN contract_address SET DEFAULT '';
ALTER TABLE donations ALTER COLUMN contract_address SET DEFAULT '';
ALTER TABLE ratings ALTER COLUMN contract_address SET DEFAULT '';
ALTER TABLE comments ALTER COLUMN contract_address SET DEFAULT '';
ALTER TABLE page_views ALTER COLUMN contract_address SET DEFAULT '';
