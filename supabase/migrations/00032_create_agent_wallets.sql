-- Agent wallets managed via OWS (Open Wallet Standard)
create table if not exists agent_wallets (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references agents(id) on delete cascade,
  wallet_id     text not null unique,
  wallet_name   text not null,
  address_base  text not null,
  api_key_id    text,
  policy_ids    text[] default '{}',
  spend_cap_usdc numeric not null default 10,
  created_at    timestamptz not null default now(),
  is_active     boolean not null default true
);

-- Index for lookups by agent
create index if not exists idx_agent_wallets_agent_id on agent_wallets(agent_id);

-- RLS: owner can read/update their agent's wallet info
alter table agent_wallets enable row level security;

create policy "Agent owner can read own wallets"
  on agent_wallets for select
  using (
    agent_id in (
      select id from agents where owner_address = auth.jwt()->>'sub'
    )
  );

create policy "Agent owner can update own wallets"
  on agent_wallets for update
  using (
    agent_id in (
      select id from agents where owner_address = auth.jwt()->>'sub'
    )
  );

create policy "Agent owner can insert own wallets"
  on agent_wallets for insert
  with check (
    agent_id in (
      select id from agents where owner_address = auth.jwt()->>'sub'
    )
  );
