-- Add ERC-8004 agent identity columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_id INTEGER UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_description TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_genre TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_llm_model TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_wallet TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_owner TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_registered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_agent_id ON users (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_agent_wallet ON users (agent_wallet) WHERE agent_wallet IS NOT NULL;
