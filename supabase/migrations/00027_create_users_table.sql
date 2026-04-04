-- [#563] Create users table for cached Farcaster profile data
-- SteemHunt API as primary source (free), Neynar as fallback (paid)
-- Store ALL available data — Supabase storage is free, API calls are not.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fid INTEGER UNIQUE NOT NULL,
  username TEXT,
  display_name TEXT,
  pfp_url TEXT,
  custody_address TEXT,
  verified_addresses TEXT[],
  primary_address TEXT,

  -- Profile metadata
  bio TEXT,
  url TEXT,
  location TEXT,

  -- Social handles
  twitter TEXT,
  github TEXT,

  -- Farcaster stats
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  power_badge BOOLEAN,
  is_pro_subscriber BOOLEAN,
  neynar_score DECIMAL,
  spam_label INTEGER,
  fc_created_at TIMESTAMPTZ,

  -- X/Twitter stats
  x_followers_count BIGINT,
  x_following_count BIGINT,
  x_verified BOOLEAN,
  x_display_name TEXT,
  x_stats_fetched_at TIMESTAMPTZ,

  -- Quotient score
  quotient_score DECIMAL(10,4),
  quotient_rank INTEGER,
  quotient_labels JSONB,
  quotient_updated_at TIMESTAMPTZ,

  -- Freshness tracking
  stats_fetched_at TIMESTAMPTZ,
  steemhunt_fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_users_updated_at();

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_users_fid ON users (fid);
CREATE INDEX IF NOT EXISTS idx_users_primary_address ON users (primary_address);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- Index on verified_addresses for wallet-based lookups
CREATE INDEX IF NOT EXISTS idx_users_verified_addresses ON users USING GIN (verified_addresses);

-- Non-negative constraints
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT chk_users_x_followers_non_negative CHECK (x_followers_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT chk_users_x_following_non_negative CHECK (x_following_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS: public read, service-role write
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_public_read" ON users
  FOR SELECT USING (true);

CREATE POLICY "users_service_write" ON users
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE users IS 'Cached Farcaster profile data — SteemHunt primary, Neynar fallback';
COMMENT ON COLUMN users.steemhunt_fetched_at IS 'Last SteemHunt fetch — 5-min cooldown key';
COMMENT ON COLUMN users.stats_fetched_at IS 'Last Neynar score fetch — 7-day refresh';
COMMENT ON COLUMN users.quotient_updated_at IS 'Last Quotient Score fetch — 7-day refresh';
COMMENT ON COLUMN users.x_stats_fetched_at IS 'Last X stats fetch — 5-min cooldown key';
