-- [#567] Make fid nullable for non-Farcaster wallet users
-- PlotLink must work for ALL wallet users, not just Farcaster.

ALTER TABLE users ALTER COLUMN fid DROP NOT NULL;

-- Unique index on primary_address for wallet-only user upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_primary_address_unique
  ON users (primary_address) WHERE primary_address IS NOT NULL;
