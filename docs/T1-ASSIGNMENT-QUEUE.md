# T1 Assignment Queue — PlotLink

> This is the ordered ticket queue for T1 to assign to @t3.
> After each ticket is merged, assign the next one in order.
> Operator gates are marked — T1 must complete those before assigning the next ticket.

---

## How to use

1. Assign the next ticket to @t3 via GitHub issue (add `agent/T3` label, @mention T3)
2. Wait for T3 to open PR → T2a/T2b review → T3 fixes → both approve
3. Merge the PR
4. Check the next item — if it says **OPERATOR GATE**, complete that task first
5. Assign the next ticket to @t3

---

## Track A: Web App (`realproject7/plotlink`)

### Phase 0 — Bootstrap (no operator setup needed)

| # | Issue | What T1 checks before merge |
|---|---|---|
| 1 | **plotlink#1** [P0-1] Scaffold Next.js App | App runs with `npm run dev`, terminal theme visible, .env.example complete |
| 2 | **plotlink#4** [P0-4] CI Pipeline | GitHub Actions runs lint + type-check on PR |
| 3 | **plotlink#3** [P0-3] Project Documentation | CLAUDE.md exists with project context |

> **OPERATOR GATE — plotlink#5 [P0-OP]**
> Before proceeding, T1 must:
> - [ ] Create Supabase project → save URL, anon key, service role key
> - [ ] Create Filebase account + bucket → save access key, secret key, bucket name
> - [ ] Populate `.env.local` with real credentials
> - [ ] Run Supabase migration after P0-2 is merged

| # | Issue | What T1 checks before merge |
|---|---|---|
| 4 | **plotlink#2** [P0-2] Supabase Schema | Migration SQL has all 3 tables + hidden columns, Supabase client helper works |

### Phase 1 — Content Pipeline

| # | Issue | What T1 checks before merge |
|---|---|---|
| 5 | **plotlink#8** [P1-3] Contract ABI & Constants | ABIs match proposal §4.1/§4.3, known addresses from §12 present |
| 6 | **plotlink#7** [P1-2] Content Utilities | keccak256 hash + Unicode character counting, tests pass with Korean/emoji |
| 7 | **plotlink#6** [P1-1] Filebase Upload Helper | Upload + CID retrieval works, retry wrapper included, tests pass |
| 8 | **plotlink#9** [P1-4] Inline Indexer — Plots | POST /api/index/plot works, IPFS fallback to request body, hash verification |
| 9 | **plotlink#10** [P1-5] Inline Indexer — Storylines | POST /api/index/storyline works, ERC-8004 agent detection (best-effort) |
| 10 | **plotlink#11** [P1-6] Inline Indexer — Donations | POST /api/index/donation works |
| 11 | **plotlink#12** [P1-7] Cron Backfill | /api/cron/backfill scans events and fills missing records, cron config set |

### Phase 3 — Core Write & Read

> **WAIT**: Phase 3 depends on Phase 2 contracts being deployed to Base Sepolia.
> Track B (contracts) should be far enough along before starting here.
> At minimum, contracts#7 [P2-7] must be complete (testnet deployment).

| # | Issue | What T1 checks before merge |
|---|---|---|
| 12 | **plotlink#18** [P3-5] RPC Client Setup | Public client for Base works, fallback RPCs configured |
| 13 | **plotlink#14** [P3-1] Wallet Connection | Connect/disconnect works on Base, terminal-styled button |
| 14 | **plotlink#15** [P3-2] Create Storyline Flow | Full 5-state publish flow works (IPFS → wallet → tx → index → done), CID caching on retry |
| 15 | **plotlink#16** [P3-3] Chain Plot Flow | Chain plot works, reuses publish state machine from P3-2 |
| 16 | **plotlink#17** [P3-4] Story Page — Reading | Story renders as continuous reading, deadline countdown, sunset badge |

### Phase 4 — Discovery & Dashboards

| # | Issue | What T1 checks before merge |
|---|---|---|
| 17 | **plotlink#19** [P4-1] Discovery Page — Layout & Tabs | Tab navigation works, story card component exists |
| 18 | **plotlink#20** [P4-2] Discovery Page — Tab Queries | New + Completed tabs query Supabase, Trending/Rising are placeholder |
| 19 | **plotlink#21** [P4-3] Writer Dashboard | Lists writer's storylines, plot counts, deadlines |
| 20 | **plotlink#22** [P4-4] Reader Dashboard | Shows donation history |

### Phase 5 — Token Trading

> **OPERATOR GATE — plotlink#31 [P5-OP]**
> Before proceeding, T1 must:
> - [ ] Create $PLOT token on Mint Club V2 (backed by $HUNT)
> - [ ] Update `lib/contracts/constants.ts` with $PLOT address

| # | Issue | What T1 checks before merge |
|---|---|---|
| 21 | **plotlink#23** [P5-1] Token Price Display | Price reads from MCV2_Bond, displays on story page |
| 22 | **plotlink#24** [P5-2] Trading Widget | Buy/sell works with $PLOT, slippage protection |
| 23 | **plotlink#25** [P5-3] Price Chart | Bonding curve visualization with current position marked |
| 24 | **plotlink#26** [P5-4] Donation Flow | Donate button works, triggers donation indexer |
| 25 | **plotlink#27** [P5-5] Royalty Claiming | Claim button in writer dashboard, gated by plot_count >= 2 |
| 26 | **plotlink#28** [P5-6] Trending & Rising Discovery | Composite ranking for Trending, acceleration for Rising |
| 27 | **plotlink#29** [P5-7] Dashboard Trading Stats | Writer: earnings + volume. Reader: holdings + portfolio |
| 28 | **plotlink#30** [P5-9] Zap Frontend Integration | Token selector (ETH/USDC/HUNT/$PLOT) in trading widget, Zap routing |

### Phase 6 — Agent Layer

| # | Issue | What T1 checks before merge |
|---|---|---|
| 29 | **plotlink#32** [P6-1] Agent Registration Wizard | 3-step wizard, ERC-8004 register + setAgentWallet, redirects to create story |
| 30 | **plotlink#33** [P6-2] Writer Type Filter & Badge | Filter in discovery, agent badge on cards/pages |
| 31 | **plotlink#34** [P6-3] CLI — plotlink-cli | All 6 commands work (create, chain, status, claim, agent register) |
| 32 | **plotlink#35** [P6-4] SDK — @plotlink/sdk | All methods work, package builds cleanly |

### Phase 7 — Farcaster

| # | Issue | What T1 checks before merge |
|---|---|---|
| 33 | **plotlink#36** [P7-1] Mini App Manifest & SDK Setup | Manifest at /.well-known/farcaster.json, sdk.actions.ready() called |
| 34 | **plotlink#37** [P7-2] Farcaster Wallet Integration | Farcaster wagmi connector works alongside standalone wallets |
| 35 | **plotlink#38** [P7-3] Social Sharing & Embed Meta Tags | Share button works, fc:miniapp meta tags on story pages |
| 36 | **plotlink#39** [P7-4] Farcaster Identity Display | FID detected, profile shown where writer address appears |

### Phase 8 — Launch

| # | Issue | What T1 checks before merge |
|---|---|---|
| 37 | **plotlink#40** [P8-1] Content Moderation | Admin hide/unhide API, all queries filter hidden content |
| 38 | **plotlink#41** [P8-2] Mainnet Deployment | Addresses updated, contracts verified on Basescan |

> **OPERATOR GATE — plotlink#41 [P8-2] operator tasks**
> - [ ] Deploy StoryFactory to Base mainnet
> - [ ] Deploy ZapPlotLinkMCV2 to Base mainnet
> - [ ] Configure plotlink.xyz domain + hosting
> - [ ] Set production env vars

---

## Track B: Contracts (`realproject7/plotlink-contracts`)

> Track B can run **in parallel** with Track A Phase 1.
> Assign to T3 when Track A Phase 0 is complete and T3 has bandwidth,
> or interleave with Track A tickets.

| # | Issue | What T1 checks before merge |
|---|---|---|
| 1 | **contracts#1** [P2-1] Contract Repo Setup | Foundry project compiles, IMCV2_Bond interface matches deployed contract |
| 2 | **contracts#2** [P2-2] Core State & Events | Storyline struct, mappings, events defined, compiles |
| 3 | **contracts#3** [P2-3] createStoryline() | Creates token on MCV2_Bond, transfers creator to writer, emits events |
| 4 | **contracts#4** [P2-4] chainPlot() | All validations (access, CID, sunset, deadline), emits PlotChained |
| 5 | **contracts#5** [P2-5] donate() | $PLOT transfer + event emission |
| 6 | **contracts#6** [P2-6] Tests | All tests pass — createStoryline, chainPlot (happy + reverts), donate |
| 7 | **contracts#7** [P2-7] Testnet Deploy & Gas | Deployed to Base Sepolia, gas numbers documented |

> After contracts#7, assign back on plotlink repo:

| # | Issue | What T1 checks before merge |
|---|---|---|
| 8 | **plotlink#13** [P2-8] Update Proposal TBDs | All TBD gas values in proposal replaced with measured values |

> **ZapPlotLinkMCV2** — assign after P5-OP (operator creates $PLOT):

| # | Issue | What T1 checks before merge |
|---|---|---|
| 9 | **contracts#8** [P5-8] ZapPlotLinkMCV2 | Double-hop mint works, tests pass, gas within estimates |

---

## Quick reference — Operator Gates

| When | Gate | What to do |
|---|---|---|
| After Track A #3 merged | **plotlink#5** [P0-OP] | Create Supabase + Filebase, populate .env.local |
| Before Track A #21 | **plotlink#31** [P5-OP] | Create $PLOT token on Mint Club V2 |
| Before Track B #7 | **contracts#7** operator task | Fund deployer on Base Sepolia |
| After Track A #37 | **plotlink#41** operator tasks | Deploy mainnet, configure domain |
