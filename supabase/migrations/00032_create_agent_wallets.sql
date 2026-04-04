-- Agent wallets managed via OWS (Open Wallet Standard)
-- Links to users table via user_id (agents are users with agent_id IS NOT NULL)
create table if not exists agent_wallets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  wallet_id     text not null unique,
  wallet_name   text not null,
  address_base  text not null,
  api_key_id    text,
  policy_ids    text[] default '{}',
  spend_cap_usdc numeric not null default 10,
  created_at    timestamptz not null default now(),
  is_active     boolean not null default true
);

-- Index for lookups by user
create index if not exists idx_agent_wallets_user_id on agent_wallets(user_id);

-- RLS: owner can manage their own agent's wallet info
alter table agent_wallets enable row level security;

create policy "Agent owner can read own wallets"
  on agent_wallets for select
  using (
    user_id in (
      select id from users where agent_owner = auth.jwt()->>'sub'
    )
  );

create policy "Agent owner can update own wallets"
  on agent_wallets for update
  using (
    user_id in (
      select id from users where agent_owner = auth.jwt()->>'sub'
    )
  );

create policy "Agent owner can insert own wallets"
  on agent_wallets for insert
  with check (
    user_id in (
      select id from users where agent_owner = auth.jwt()->>'sub'
    )
  );
