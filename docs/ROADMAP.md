# PlotLink Development Roadmap

> Source: `PROPOSAL-plotlink.md` (v5, 2026-03-13)
> Repo: `realproject7/plotlink` (private, web app)
> Contract repo: `realproject7/plotlink-contracts` (public)

---

## Phase Overview

| Phase | Name | Proposal Sections | Depends On | Deliverable |
|---|---|---|---|---|
| **0** | Project Bootstrap | §6.1 (design direction) | — | Running Next.js dev server, Supabase connected, terminal theme |
| **1** | Content Pipeline | §4.1 | P0 | IPFS upload + Supabase indexing pipeline working end-to-end |
| **2** | Smart Contracts | §4.2, §4.3, §4.4 | P0 | StoryFactory deployed to Base Sepolia (`0x05C4d59529807316D6fA09cdaA509adDfe85b474`), gas measured |
| **3** | Core Write & Read | §4.1 (write flow UX), §6.2 | P1, P2 | Writer can publish plots and readers can read stories |
| **4** | Discovery & Dashboards | §6.3, §6.4, §6.5 | P3 | Users can browse stories and track activity |
| **5** | Token Trading | §3.1–§3.9, §4.5 | P2, P3 | Readers can buy/sell tokens, writers earn royalties |
| **6** | Agent Layer | §5.1–§5.4 | P3, P5 | Agent registration, detection, CLI, SDK |
| **7** | Farcaster | §7.1–§7.4 | P3, P4 | PlotLink works as a Farcaster mini app |
| **8** | Launch Prep | §8 (risks) | All | Content moderation, mainnet deploy, domain |

**Post-MVP** (not phased): Story Wrapped (§6.6), Webhooks (§5.3), Agent template repo (§5.3), Arweave third copy (§4.1), Historical backfill script (§4.1)

---

## Phase 0: Project Bootstrap

**Proposal sections**: §6.1 (Terminal Aesthetic)
**Deliverable**: Running Next.js dev server with Supabase connected, terminal design system in place

---

### P0-1: Scaffold Next.js App

Initialize the web app with the project's core tech stack.

**Context**: PlotLink is a Next.js App Router project with TypeScript and Tailwind CSS. The design direction (§6.1) is mobile-first with a terminal/monospace aesthetic — dark background, light text, outline-based UI, no fills, no shadows.

**Sub-tickets**:
- **P0-1a**: Initialize Next.js project with App Router, TypeScript, Tailwind CSS, ESLint. Configure path aliases (`@/` → `src/`).
- **P0-1b**: Set up terminal design system — monospace font, dark color palette, CSS variables for the design tokens (background, text, accent, border). Create a minimal global stylesheet following §6.1.
- **P0-1c**: Create `.env.example` listing all environment variables the project will need. Reference the proposal §4.1 (Filebase, Supabase, RPC) and §12 (External Dependencies) for the full list. Leave values empty — just document what each var is for.

---

### P0-2: Supabase Schema

Set up the database schema from the proposal.

**Context**: The Supabase schema is defined in §4.1. Three tables: `storylines`, `plots`, `donations`. The schema includes deduplication constraints (`UNIQUE(tx_hash, log_index)`), foreign keys, and an indexer-set `writer_type` column. Also add a `hidden` boolean column to `storylines` and `plots` for MVP content moderation (§8 Risks table).

**Sub-tickets**:
- **P0-2a**: Create SQL migration file(s) with all three tables exactly as specified in §4.1, plus the `hidden` column (default false) on `storylines` and `plots`.
- **P0-2b**: Create Supabase client helper (`lib/supabase.ts`) — server-side client using service role key, and a browser-side client using anon key. Follow the pattern used in other project repos (dropcast, reviewme-fun).

---

### P0-3: Project Documentation

**Sub-tickets**:
- **P0-3a**: Create `CLAUDE.md` for the plotlink repo. Include: project purpose (one paragraph), tech stack, repo structure conventions, link to the proposal (`docs/PROPOSAL-plotlink.md`), and any build/test commands. Follow the format of other repos in the org.

---

### P0-4: CI Pipeline

**Sub-tickets**:
- **P0-4a**: Create `.github/workflows/ci.yml` — runs lint + type-check on every PR. Keep it minimal.

---

### P0-OP: Operator Tasks (Phase 0)

These require manual setup by the operator:

- **P0-OP1**: Create a Supabase project for PlotLink. Save the project URL, anon key, and service role key.
- **P0-OP2**: Create a Filebase account and bucket for IPFS uploads. Save the access key, secret key, and bucket name.
- **P0-OP3**: Populate `.env.local` from `.env.example` with real credentials from P0-OP1 and P0-OP2.
- **P0-OP4**: Run the Supabase migration from P0-2a against the project.

---

## Phase 1: Content Pipeline

**Proposal sections**: §4.1 (Content Storage & Indexing)
**Depends on**: Phase 0
**Deliverable**: Working Filebase IPFS upload + Supabase inline indexing pipeline. Content can be uploaded, indexed, and read back.

---

### P1-1: Filebase Upload Helper

Implement the IPFS upload module.

**Context**: PlotLink uploads chapter content to Filebase (S3-compatible IPFS pinning), then stores only the CID onchain. The upload pattern is proven in `dropcast/lib/relayer.ts` — same S3Client, PutObjectCommand, HeadObjectCommand flow. The CID comes from the HeadObject response metadata (`Metadata.cid`).

**Sub-tickets**:
- **P1-1a**: Implement `lib/filebase.ts` with `getFilebaseClient()` and `uploadToIPFS(content: string, key: string): Promise<string>`. The function uploads content as `text/plain; charset=utf-8` and returns the CID.
- **P1-1b**: Implement `uploadWithRetry()` wrapper — 3 attempts, exponential backoff (1s, 2s, 4s). Same pattern as dropcast's `uploadToIPFSWithRetry`.
- **P1-1c**: Write unit tests for the upload helper (mock the S3Client).

---

### P1-2: Content Utilities

**Context**: Two utilities needed across the app: content hash computation (keccak256) for verification, and Unicode-aware character count validation (500–10,000 chars). These are used by the frontend write flow, the indexer, and the CLI/SDK.

**Sub-tickets**:
- **P1-2a**: Implement `lib/content.ts` — `hashContent(content: string): Hex` (keccak256) and `validateContentLength(content: string): { valid: boolean, charCount: number }` (uses `[...str].length` for Unicode correctness, range 500–10,000).
- **P1-2b**: Write unit tests — include Korean text, emoji, and mixed content to verify Unicode counting.

---

### P1-3: Contract ABI & Constants

Define the event ABIs and contract addresses so the indexer can parse onchain events. Contracts aren't deployed yet, but the event signatures are finalized in §4.1 and §4.3.

**Sub-tickets**:
- **P1-3a**: Create `lib/contracts/abi.ts` — define ABIs for `PlotChained`, `StorylineCreated`, and `Donation` events. Include the `chainPlot` and `createStoryline` function ABIs for frontend contract calls.
- **P1-3b**: Create `lib/contracts/constants.ts` — placeholder addresses for StoryFactory, $PLOT token. Include the known addresses from §12 (MCV2_Bond, Uniswap V4, Permit2, ERC-8004 registry).

---

### P1-4: Inline Indexer — Plots

The primary indexing path: frontend calls this API after a chainPlot() transaction confirms.

**Context**: Inline indexer pattern (§4.1) — no cron, no event listener. Frontend triggers indexing by POSTing the txHash. The indexer fetches the receipt, parses the PlotChained event, fetches content from IPFS by CID, verifies the content hash matches the onchain contentHash, and upserts to Supabase. If IPFS fetch times out (10s), it falls back to content provided in the request body.

**Important**: Use `publicClient.getBlock()` to get the block timestamp — it's not available on the transaction receipt.

**Sub-tickets**:
- **P1-4a**: Implement `POST /api/index/plot` route with the full flow: fetch receipt → parse event → fetch from IPFS (with timeout) → fallback to request body content → verify hash → get block timestamp → upsert to Supabase. Deduplicate on `(tx_hash, log_index)`.

---

### P1-5: Inline Indexer — Storylines

Same inline pattern for storyline creation events.

**Context**: When a storyline is created, the indexer needs to: parse the StorylineCreated event, insert the storyline record into Supabase, and determine `writer_type` by querying ERC-8004 off-chain (see §5.2 — agent detection is indexer-layer, not onchain). For MVP, the ERC-8004 query can be a best-effort check that defaults to `writer_type = 0` (human) if the registry call fails.

**Sub-tickets**:
- **P1-5a**: Implement `POST /api/index/storyline` route — fetch receipt, parse StorylineCreated event, insert to Supabase.
- **P1-5b**: Add ERC-8004 agent detection — query the registry contract to check if the writer address is a registered agentWallet. Set `writer_type` accordingly. Default to 0 if query fails.

---

### P1-6: Inline Indexer — Donations

**Sub-tickets**:
- **P1-6a**: Implement `POST /api/index/donation` route — fetch receipt, parse Donation event, insert to Supabase.

---

### P1-7: Cron Backfill

Safety net for when the inline indexer misses a plot.

**Context**: §4.1 MVP addition — a cron job running every 5 minutes that scans recent StoryFactory events and inserts any plots/storylines missing from Supabase. Same verify-and-insert logic as the inline indexer.

**Sub-tickets**:
- **P1-7a**: Implement `/api/cron/backfill` route — query recent PlotChained and StorylineCreated events from the last N blocks, check which are missing in Supabase, re-fetch from IPFS, verify, and insert.
- **P1-7b**: Configure the cron schedule (Vercel cron config or equivalent). 5-minute interval.

---

## Phase 2: Smart Contracts — StoryFactory

**Proposal sections**: §4.2 (Contract System), §4.3 (StoryFactory), §4.4 (Gas Costs)
**Depends on**: Phase 0 (but can run in parallel with Phase 1)
**Deliverable**: StoryFactory deployed to Base Sepolia (`0x05C4d59529807316D6fA09cdaA509adDfe85b474`), gas values measured and documented in `docs/PROPOSAL-plotlink.md`
**Repo**: Separate public repo — `realproject7/plotlink-contracts`

---

### P2-1: Contract Repo Setup

**Sub-tickets**:
- **P2-1a**: Initialize a Foundry project with: src/, test/, script/ directories. Add remappings for OpenZeppelin if needed. Create a basic foundry.toml targeting Base.
- **P2-1b**: Create interface files for external contracts the factory interacts with: `IMCV2_Bond` (createToken, updateBondCreator, mint, burn) and `IERC20` (approve, transfer, balanceOf). Reference the MCV2_Bond contract at `0xc5a076cad94176c2996B32d8466Be1cE757FAa27` on Base for the ABI.

**Operator**:
- **P2-1-OP**: Create `realproject7/plotlink-contracts` repo (public) on GitHub.

---

### P2-2: StoryFactory — Core State & Events

**Context**: §4.3 defines the Storyline struct (writer, token, plotCount, lastPlotTime, hasDeadline, sunset), the `storylines` mapping, `storylineCount`, and three events (StorylineCreated, PlotChained, Donation). The contract has no admin, no owner, no upgrade mechanism. It's immutable after deployment.

**Sub-tickets**:
- **P2-2a**: Implement the Storyline struct, storage mappings, and all three event definitions. Include the $PLOT token address and MCV2_Bond address as immutable constructor parameters.

---

### P2-3: StoryFactory — createStoryline()

**Context**: §4.3 — this function creates a storyline token on Mint Club's MCV2_Bond, transfers the creator role to the writer, emits the genesis plot event, and stores storyline metadata. The bonding curve parameters (500-step Mintpad Medium J-curve, §3.5) are the same for every storyline — they should be hardcoded or set at deployment. The function takes: title, openingCID, openingHash, hasDeadline.

**Resolved**: Bonding curve uses Mintpad Medium J-Curve (500 steps, steepness 0.85, exponent 4). Curve generation is in `plotlink-contracts/script/DeployBaseSepolia.s.sol`. Measured `createStoryline()` gas: 14,282,950.

**Sub-tickets**:
- **P2-3a**: Implement `createStoryline()` — call MCV2_Bond.createToken() with curve parameters, call updateBondCreator() to transfer creator to msg.sender, store the Storyline struct, emit StorylineCreated and PlotChained events.

---

### P2-4: StoryFactory — chainPlot()

**Context**: §4.3 — access-controlled to the storyline writer. Validates CID length (46–100 bytes), checks the storyline isn't sunset, enforces mandatory 7-day deadline. Increments plotCount and lastPlotTime. Emits PlotChained event with CID + contentHash. Measured gas: 39,826 (below the ~47k estimate).

**Sub-tickets**:
- **P2-4a**: Implement `chainPlot()` with all validations as specified in §4.3.

---

### P2-5: StoryFactory — donate()

**Context**: §4.3 — transfers $PLOT from donor to the storyline writer. Emits a Donation event. The donor must have approved the StoryFactory for $PLOT spending beforehand.

**Sub-tickets**:
- **P2-5a**: Implement `donate()` — transferFrom $PLOT, emit Donation event.

---

### P2-6: StoryFactory Tests

**Sub-tickets**:
- **P2-6a**: Test `createStoryline()` — happy path, verify token creation, creator transfer, event emission, struct storage.
- **P2-6b**: Test `chainPlot()` — happy path, wrong writer reverts, invalid CID reverts, sunset reverts, deadline expired reverts, deadline not enabled allows late writes.
- **P2-6c**: Test `donate()` — happy path, insufficient allowance reverts.

---

### P2-7: Testnet Deployment & Gas Measurement

**Context**: Gas values measured on Base Sepolia — `createStoryline()`: 14,282,950 gas, `chainPlot()`: 39,826 gas. See `docs/PROPOSAL-plotlink.md` §4.4 for full analysis.

**Sub-tickets**:
- **P2-7a**: Write a Foundry deployment script for Base Sepolia. The script should deploy StoryFactory pointing at the real MCV2_Bond on Base Sepolia (or a mock if MCV2 isn't on Sepolia).
- **P2-7b**: After deployment, run `createStoryline()` and `chainPlot()` on Sepolia. Record exact gas used. Document results.

**Operator**:
- **P2-7-OP**: Fund the deployer wallet on Base Sepolia with testnet ETH.

---

### P2-8: Update Proposal TBDs

After gas measurements are available, update the proposal document.

**Sub-tickets**:
- **P2-8a**: Update `docs/PROPOSAL-plotlink.md` — replace all TBD gas values in §4.3, §4.4, and §4.1 cost tables with measured values from P2-7b.

---

## Phase 3: Core Write & Read

**Proposal sections**: §4.1 (Write Flow + UX), §6.2 (Story Page)
**Depends on**: Phase 1 (content pipeline), Phase 2 (contract deployed to testnet)
**Deliverable**: Writer can create storylines, chain plots, and readers can read stories on the web app.

---

### P3-1: Wallet Connection

**Context**: PlotLink uses wagmi + viem for Base chain wallet interaction. This is the standard pattern used across the org's projects (dropcast, mintpad). Needs to support both standalone web and Farcaster mini app wallet providers (Farcaster integration comes in Phase 7, but the wallet provider setup should be extensible).

**Sub-tickets**:
- **P3-1a**: Install wagmi, viem, @tanstack/react-query. Configure wagmi for Base chain. Create the providers/config.
- **P3-1b**: Build a ConnectWallet button component — shows connected address (truncated), disconnect option. Terminal aesthetic styling.

---

### P3-2: Create Storyline Flow

**Context**: §4.1 (Write Flow) + §3.7 (Deadline). The writer fills in a title, writes the opening chapter (genesis plot), with a mandatory 7-day deadline. The publishing flow has 5 UX states defined in §4.1: uploading → confirm in wallet → publishing to Base → indexing → published. On failure, the CID should be cached locally so retries skip the IPFS upload.

**Sub-tickets**:
- **P3-2a**: Build the Create Storyline page/form — title input, content textarea with Unicode-aware character counter (500–10,000), hasDeadline toggle.
- **P3-2b**: Implement the publishing state machine — manages the 5 states from §4.1. Handles: IPFS upload (with retry), wallet tx submission, tx confirmation wait, inline indexer call. Cache CID locally for retry.
- **P3-2c**: Wire up the form to the state machine — calls Filebase upload, then `createStoryline()` on the contract, then the storyline indexer API. Show appropriate UI state at each step. Handle all failure scenarios from §4.1's failure recovery table.

---

### P3-3: Chain Plot Flow

**Context**: Same write flow as P3-2 but for subsequent plots. The writer selects a storyline and writes the next chapter. Same 5 publishing states. The contract function is `chainPlot(storylineId, contentCID, contentHash)`.

**Sub-tickets**:
- **P3-3a**: Build the Chain Plot form — content textarea with character counter. Reuse the publishing state machine from P3-2b.
- **P3-3b**: Wire to contract + indexer — calls Filebase upload, then `chainPlot()`, then the plot indexer API.

---

### P3-4: Story Page — Reading Experience

**Context**: §6.2 — each storyline has a dedicated page showing the full plot sequence as a continuous reading experience. Terminal aesthetic. Also shows: writer identity, plot count, deadline countdown (if enabled), sunset badge (if applicable). The trading widget and stats come in Phase 5 — this ticket is reading-only.

**Sub-tickets**:
- **P3-4a**: Build the story page layout — fetch storyline + all plots from Supabase, render as a continuous reading experience. Show writer address, plot count, title.
- **P3-4b**: Add deadline countdown component — show remaining time until sunset based on `last_plot_time + 7 days`.
- **P3-4c**: Add sunset state display — if storyline is sunset, show a "Story complete" badge with total plot count.

---

### P3-5: RPC Client Setup

**Context**: The web app needs a viem public client for reading contract state (storyline data, token prices, etc.) and a wallet client for write operations. Base chain, same RPC setup pattern as other org projects.

**Sub-tickets**:
- **P3-5a**: Create `lib/rpc.ts` — public client for Base with fallback RPC endpoints. Export as a reusable singleton.

---

## Phase 4: Discovery & Dashboards

**Proposal sections**: §6.3 (Discovery), §6.4 (Writer Dashboard), §6.5 (Reader Dashboard)
**Depends on**: Phase 3
**Deliverable**: Users can browse and discover stories, writers and readers can track their activity.

---

### P4-1: Discovery Page — Layout & Tabs

**Context**: §6.3 — discovery has tabs: Trending, New, Rising, Completed. Trending uses composite ranking signals (unique buyer count, holder diversity, recent trading activity — not raw volume alone). Genre tags are writer-assigned at genesis.

**Sub-tickets**:
- **P4-1a**: Build the discovery page layout with tab navigation (Trending, New, Rising, Completed). Terminal aesthetic.
- **P4-1b**: Build a story card component — shows title, writer address, plot count, and genre tag. This is reused across all tabs. Trading-related stats (price, volume, holders) will be added in Phase 5.

---

### P4-2: Discovery Page — Tab Queries

**Sub-tickets**:
- **P4-2a**: Implement the "New" tab — query Supabase for recently created storylines, sorted by creation time descending. Exclude hidden content.
- **P4-2b**: Implement the "Completed" tab — query for storylines where `sunset = true`, sorted by plot count or creation time.
- **P4-2c**: The "Trending" and "Rising" tabs depend on trading data from Phase 5. Create placeholder tabs that show "Coming soon" or fall back to "New" ordering. Add a TODO note linking to Phase 5.

---

### P4-3: Writer Dashboard

**Context**: §6.4 — shows stories launched, total earned, per-story breakdown, claimable royalties, deadline countdowns. Trading/royalty data depends on Phase 5 — this ticket builds the layout and the data that's available now (storylines, plot counts, deadlines).

**Sub-tickets**:
- **P4-3a**: Build writer dashboard page — list the connected wallet's storylines with plot count, deadline countdown, sunset status. Fetches from Supabase filtered by `writer_address`.
- **P4-3b**: Add per-story detail section — plot count, creation date, has_deadline status. Royalty and trading stats will be added in Phase 5.

---

### P4-4: Reader Dashboard

**Context**: §6.5 — shows tokens held, portfolio value, donation history, reading progress. Token/portfolio data depends on Phase 5. This ticket builds the layout and donation history.

**Sub-tickets**:
- **P4-4a**: Build reader dashboard page — show donation history from Supabase (filtered by `donor_address`). Token holdings and portfolio value will be added in Phase 5.

---

## Phase 5: Token Trading & Economics

**Proposal sections**: §3.1–§3.9 (Token Economy), §4.5 (Zap Contract)
**Depends on**: Phase 2 (contracts), Phase 3 (story page exists)
**Deliverable**: Readers can buy/sell storyline tokens, donate $PLOT, writers can claim royalties.

---

### P5-1: Token Price Display

**Context**: Each storyline token has a price on MCV2_Bond's bonding curve. The price is derived from the curve's current state. MCV2_Bond provides view functions to get price estimates for a given mint/burn amount.

**Sub-tickets**:
- **P5-1a**: Create a price utility (`lib/price.ts`) that reads the current token price and supply from MCV2_Bond for a given storyline token address.
- **P5-1b**: Add token price display to the story page (§6.2) — current price, total supply minted.

---

### P5-2: Trading Widget

**Context**: §6.2 — buy/sell storyline tokens with $PLOT on the story page. Uses MCV2_Bond's `mint()` and `burn()` functions. The bonding curve makes the price deterministic — the widget should show an estimated price before the user confirms. Include slippage protection.

**Sub-tickets**:
- **P5-2a**: Build the trading widget component — buy/sell tabs, amount input, estimated cost/return display. Reads estimates from MCV2_Bond view functions.
- **P5-2b**: Implement buy flow — approve $PLOT → call MCV2_Bond.mint() for the storyline token. Show tx states.
- **P5-2c**: Implement sell flow — call MCV2_Bond.burn() for the storyline token → receive $PLOT. Show tx states.

---

### P5-3: Price Chart

**Sub-tickets**:
- **P5-3a**: Build a token price chart component for the story page. Can use bonding curve math to show the price curve shape, and mark the current supply position on it. Lightweight — no historical price tracking needed for MVP.

---

### P5-4: Donation Flow

**Context**: §3.3 — readers can donate $PLOT directly to the writer via `StoryFactory.donate()`. This is a "tip the author" action, separate from trading.

**Sub-tickets**:
- **P5-4a**: Add a donate button + amount input to the story page. Calls `donate()` on StoryFactory after $PLOT approval. Triggers the donation indexer API.

---

### P5-5: Royalty Claiming

**Context**: §3.2 — writers claim accumulated royalties directly from Mint Club via `MCV2_Bond.claimRoyalties(tokenAddress)`. The frontend gates the "Claim" button until at least plot #1 is chained (plotCount >= 2) to prevent zero-content farming (§8 Risks).

**Sub-tickets**:
- **P5-5a**: Add "Claim Royalties" to the writer dashboard (P4-3). Show unclaimed balance per storyline by reading from MCV2_Bond. Hide the button if `plot_count < 2`.
- **P5-5b**: Implement claim transaction — calls `MCV2_Bond.claimRoyalties()`. Show success with claimed amount.

---

### P5-6: Trending & Rising Discovery Tabs

Now that trading data is available, complete the discovery tabs from P4-2c.

**Sub-tickets**:
- **P5-6a**: Implement "Trending" tab — rank stories by composite signals. Define the ranking formula using available onchain/Supabase data (trading volume, unique buyers, holder count, recency).
- **P5-6b**: Implement "Rising" tab — stories with accelerating trading activity compared to their prior period.

---

### P5-7: Dashboard Trading Stats

Add trading-related data to the dashboards built in Phase 4.

**Sub-tickets**:
- **P5-7a**: Writer dashboard — add total $PLOT earned (royalties + donations), per-story trading volume, holder count.
- **P5-7b**: Reader dashboard — add token holdings (query MCV2_Bond balanceOf for each storyline token the user holds), portfolio value, best-performing pick.

---

### P5-8: ZapPlotLinkMCV2 Contract

**Context**: §4.5 — fork MintPad's `ZapUniV4MCV2` and add a second MCV2 Bond hop so readers can buy storyline tokens with ETH/USDC/HUNT in a single transaction. This goes in the `plotlink-contracts` repo.

**Sub-tickets**:
- **P5-8a**: Fork `ZapUniV4MCV2.sol` → `ZapPlotLinkMCV2.sol`. Add the second MCV2 Bond hop (HUNT → $PLOT → Storyline Token). Remove MT support. Add $PLOT as immutable address. Both `mint()` (exact output) and `mintReverse()` (exact input) + corresponding `view` estimate functions. Follow §4.5 spec exactly.
- **P5-8b**: Write tests for the double-hop mint — test all input paths (ETH, USDC, HUNT), slippage protection, refund logic.
- **P5-8c**: Deploy to Base Sepolia, verify gas estimates match §4.5 predictions.

**Operator**:
- **P5-8-OP**: Deploy Zap contract to Base Sepolia (testnet).

---

### P5-9: Zap Frontend Integration

**Context**: §4.5 — the frontend needs a zap helper that estimates costs and executes the multi-hop buy. Follow the MintPad pattern (`mintpad/src/helpers/zap.ts`).

**Sub-tickets**:
- **P5-9a**: Create `lib/zap.ts` — `getZapQuote()` and `executeZapMint()` functions. Uses the Zap contract's estimate and mint functions.
- **P5-9b**: Add input token selector to the trading widget (P5-2) — let readers choose ETH, USDC, HUNT, or $PLOT. Route through Zap for non-$PLOT inputs, direct MCV2 for $PLOT.

---

### P5-OP: Operator Tasks (Phase 5)

- **P5-OP1**: Create $PLOT token on Mint Club V2 (backed by $HUNT). Set bonding curve parameters. This is an operator action on mint.club.
- **P5-OP2**: Update `lib/contracts/constants.ts` with the $PLOT token address after creation.

---

## Phase 6: Agent Writer Layer

**Proposal sections**: §5.1–§5.4
**Depends on**: Phase 3 (write flow), Phase 5 (trading for agent feedback)
**Deliverable**: Agent operators can register agents, write via CLI/SDK, and are correctly tagged in the UI.

---

### P6-1: Agent Registration Wizard (Web)

**Context**: §5.2 — 3-step wizard wrapping ERC-8004's `register()` and `setAgentWallet()`. Step 1: agent profile form. Step 2: register identity tx (returns agentId NFT). Step 3: link operational wallet via EIP-712 signature. The ERC-8004 registry is at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on Base. The agentURI metadata schema is defined in §5.2.

**Sub-tickets**:
- **P6-1a**: Build Step 1 — agent profile form (name, description, genre, LLM model). Auto-generate the agentURI metadata JSON per the ERC-8004 spec shown in §5.2.
- **P6-1b**: Build Step 2 — call `register(agentURI)` on the ERC-8004 registry contract. Show agentId on success.
- **P6-1c**: Build Step 3 — agent wallet input, generate EIP-712 typed data for wallet acceptance, call `setAgentWallet(agentId, newWallet, signature, deadline)`. Redirect to "Create your first story" on success.

---

### P6-2: Writer Type Filter & Agent Badge

**Context**: §5.1 — readers can filter discovery by "Human only", "Agent only", or "All" (default). Agent storylines show a badge. The `writer_type` is set by the indexer (P1-5b), not onchain.

**Sub-tickets**:
- **P6-2a**: Add writer type filter to the discovery page (P4-1) — three options. Filters the Supabase query by `writer_type`.
- **P6-2b**: Create an agent badge component — displayed on story cards and story pages for `writer_type = 1` storylines.

---

### P6-3: CLI — plotlink-cli

**Context**: §5.3 — the CLI provides: `plotlink agent register`, `plotlink create`, `plotlink chain`, `plotlink status`, `plotlink claim`. It wraps the same Filebase upload + contract call + indexer flow as the web app. Can be a separate package in the monorepo or a standalone directory.

**Sub-tickets**:
- **P6-3a**: Scaffold the CLI package — set up the command parser (commander.js or similar), config file loading (reads private key + RPC from env or config file).
- **P6-3b**: Implement `plotlink create` — reads content from file, validates character count, uploads to IPFS, calls `createStoryline()`, triggers indexer.
- **P6-3c**: Implement `plotlink chain` — reads content from file, uploads to IPFS, calls `chainPlot()`, triggers indexer.
- **P6-3d**: Implement `plotlink status` — queries Supabase for storyline data (plot count, deadline remaining) and MCV2_Bond for token price.
- **P6-3e**: Implement `plotlink claim` — calls `MCV2_Bond.claimRoyalties()` for the storyline's token address.
- **P6-3f**: Implement `plotlink agent register` — generates agentURI metadata, calls ERC-8004 `register()` + `setAgentWallet()`. Requires both operator key and agent wallet key.

---

### P6-4: SDK — @plotlink/sdk

**Context**: §5.3 — TypeScript SDK wrapping all PlotLink operations for programmatic access. Used by agent operators and the CLI. Constructor takes `{ privateKey, rpcUrl }`. Methods: `registerAgent`, `createStoryline`, `chainPlot`, `getStoryline`, `getPlots`, `claimRoyalties`.

**Sub-tickets**:
- **P6-4a**: Scaffold the SDK package — TypeScript, tsup or similar bundler, package.json with proper exports.
- **P6-4b**: Implement core methods — `createStoryline()`, `chainPlot()`, `getStoryline()`, `getPlots()`. These wrap contract calls + Filebase upload + indexer trigger.
- **P6-4c**: Implement agent methods — `registerAgent()` wrapping ERC-8004 registration.
- **P6-4d**: Implement royalty method — `claimRoyalties(tokenAddress)` wrapping MCV2_Bond call.

---

## Phase 7: Farcaster Integration

**Proposal sections**: §7.1–§7.4
**Depends on**: Phase 3 (core UX), Phase 4 (discovery)
**Deliverable**: PlotLink works as a Farcaster mini app with social sharing.

---

### P7-1: Mini App Manifest & SDK Setup

**Context**: §7.1 — PlotLink is available as a Farcaster mini app. Requires a manifest at `/.well-known/farcaster.json` with `homeUrl`. Must call `sdk.actions.ready()` on load to dismiss the splash screen. Uses `@farcaster/miniapp-sdk`.

**Sub-tickets**:
- **P7-1a**: Install `@farcaster/miniapp-sdk` and `@farcaster/miniapp-wagmi-connector`. Create the manifest file at `public/.well-known/farcaster.json`.
- **P7-1b**: Add mini app detection — check if running inside a Farcaster client. Call `sdk.actions.ready()` on mount when in mini app context.

---

### P7-2: Farcaster Wallet Integration

**Context**: §7.2 — wallet via `sdk.wallet.getEthereumProvider()` + wagmi connector. The app should work with both standalone wallets and the Farcaster embedded wallet.

**Sub-tickets**:
- **P7-2a**: Add the Farcaster wagmi connector alongside existing wallet connectors. Auto-detect context and use the appropriate provider.

---

### P7-3: Social Sharing

**Context**: §7.3 — share stories to Farcaster via `sdk.actions.composeCast()`. Story pages include `fc:miniapp` meta tags for rich embed previews (3:2 image, story title, current price, plot count, writer name).

**Sub-tickets**:
- **P7-3a**: Add "Share to Farcaster" button on story pages — calls `sdk.actions.composeCast()` with a pre-filled message and story URL.
- **P7-3b**: Add `fc:miniapp` meta tags to story pages — title, description, image (3:2 ratio). Use Next.js metadata API. The image can be a dynamically generated OG image showing story title, writer, and plot count.

---

### P7-4: Farcaster Identity Display

**Context**: §7.2 — FID is detected from the connected wallet for display identity only (profile picture, username). Not required for functionality.

**Sub-tickets**:
- **P7-4a**: Detect Farcaster FID from the connected wallet. Fetch profile data (username, avatar) from a Farcaster API. Display on story pages and dashboards where the writer's address is shown.

---

## Phase 8: Launch Prep

**Depends on**: All previous phases
**Deliverable**: Production-ready deployment with content moderation and mainnet contracts.

---

### P8-1: Content Moderation (MVP)

**Context**: §8 Risks — MVP approach is frontend hiding. The Supabase schema already has `hidden` columns (added in P0-2a). Need an admin API to flag content and frontend filtering.

**Sub-tickets**:
- **P8-1a**: Create admin API routes — `POST /api/admin/hide` and `POST /api/admin/unhide` that toggle the `hidden` flag on storylines or plots. Protect with a simple API key or admin wallet check.
- **P8-1b**: Ensure all frontend Supabase queries filter out `hidden = true` records — audit discovery, story page, dashboards.

---

### P8-2: Mainnet Deployment

**Sub-tickets**:
- **P8-2a**: Update all contract addresses in `lib/contracts/constants.ts` to mainnet values after operator deploys.
- **P8-2b**: Verify contracts on Basescan — submit source code for StoryFactory and ZapPlotLinkMCV2.

**Operator**:
- **P8-2-OP1**: Deploy StoryFactory to Base mainnet.
- **P8-2-OP2**: Deploy ZapPlotLinkMCV2 to Base mainnet.
- **P8-2-OP3**: Configure plotlink.xyz domain and deploy the web app to hosting (Vercel or similar).
- **P8-2-OP4**: Set production environment variables.

---

## Post-MVP Items

These are identified in the proposal but explicitly deferred:

| Item | Proposal Section | Trigger to Build |
|---|---|---|
| Story Wrapped (seasonal recap) | §6.6 | After first season of user activity |
| Webhooks for agent feedback | §5.3 | If agent operators request real-time events |
| Agent template repo | §5.3 | After SDK is stable, for developer adoption |
| Arweave third copy | §4.1 | If content permanence becomes a selling point |
| Historical backfill script | §4.1 | If database needs full recovery |
| ERC-8004 Reputation UI | §5.2 | If agent reputation signals prove useful |

---

## Ticket Summary

| Phase | Tickets | Sub-tickets | Operator Tasks |
|---|---|---|---|
| P0: Bootstrap | 4 | 7 | 4 |
| P1: Content Pipeline | 7 | 10 | 0 |
| P2: Contracts | 8 | 10 | 2 |
| P3: Write & Read | 5 | 9 | 0 |
| P4: Discovery & Dashboards | 4 | 6 | 0 |
| P5: Trading & Economics | 9 + OP | 14 | 2 |
| P6: Agent Layer | 4 | 12 | 0 |
| P7: Farcaster | 4 | 6 | 0 |
| P8: Launch Prep | 2 + OP | 4 | 4 |
| **Total** | **47+** | **78** | **12** |
