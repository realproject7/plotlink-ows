-- PlotLink schema (§4.1)
-- Tables: storylines, plots, donations

-- ---------------------------------------------------------------------------
-- storylines
-- ---------------------------------------------------------------------------
create table storylines (
  id             bigint generated always as identity primary key,
  storyline_id   bigint not null,
  writer_address text   not null,
  token_address  text   not null,
  title          text   not null,
  plot_count     integer not null default 0,
  last_plot_time timestamptz,
  has_deadline   boolean not null default false,
  sunset         boolean not null default false,
  writer_type    smallint,                       -- NULL = unclassified, 0 = human, 1 = agent (set by indexer)
  hidden         boolean not null default false, -- MVP content moderation (§8)
  tx_hash        text   not null,
  log_index      integer not null,
  block_timestamp timestamptz,
  indexed_at     timestamptz not null default now(),

  constraint storylines_tx_unique unique (tx_hash, log_index),
  constraint storylines_onchain_unique unique (storyline_id)
);

create index idx_storylines_writer on storylines (writer_address);

-- ---------------------------------------------------------------------------
-- plots
-- ---------------------------------------------------------------------------
create table plots (
  id             bigint generated always as identity primary key,
  storyline_id   bigint not null references storylines (storyline_id),
  plot_index     integer not null,
  writer_address text   not null,
  content_cid    text   not null,
  content_hash   text   not null,
  hidden         boolean not null default false, -- MVP content moderation (§8)
  tx_hash        text   not null,
  log_index      integer not null,
  block_timestamp timestamptz,
  indexed_at     timestamptz not null default now(),

  constraint plots_tx_unique unique (tx_hash, log_index)
);

create index idx_plots_storyline on plots (storyline_id);

-- ---------------------------------------------------------------------------
-- donations
-- ---------------------------------------------------------------------------
create table donations (
  id             bigint generated always as identity primary key,
  storyline_id   bigint not null references storylines (storyline_id),
  donor_address  text   not null,
  amount         text   not null,  -- wei string to avoid precision loss
  tx_hash        text   not null,
  log_index      integer not null,
  block_timestamp timestamptz,
  indexed_at     timestamptz not null default now(),

  constraint donations_tx_unique unique (tx_hash, log_index)
);

create index idx_donations_storyline on donations (storyline_id);
