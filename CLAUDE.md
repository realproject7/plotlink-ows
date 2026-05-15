# PlotLink OWS

On-chain storytelling protocol with a local-first AI writing assistant. Writers collaborate with Claude to brainstorm, outline, and write fiction stories, then publish them on [plotlink.xyz](https://plotlink.xyz) where every storyline becomes a tradable token.

## Writing Stories

See **AGENTS.md** for the full writing workflow. Quick summary:

1. Start `claude` in this directory
2. Say "let's write a story" — brainstorm genre, tone, characters
3. Claude creates files in `stories/your-story-name/`
4. Review, iterate, refine with Claude
5. Publish via the OWS app when ready

Stories follow this structure:
```
stories/{story-name}/
  structure.md    # Outline, characters, arc
  genesis.md      # Synopsis hook (~1000 chars)
  plot-01.md      # Chapter 1 (max 10K chars)
  ...
```

See `stories/_example/` for a complete reference.

## Tech Stack

- **Web App**: Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Supabase
- **Local Writer App**: Hono + React 19 + Vite, SQLite + Prisma, OWS wallet
- **Storage**: Filebase (IPFS)
- **Chain**: Base (L2)

## Local Writer API

The local writer app runs on `http://localhost:7777` (configurable via `APP_PORT`). All endpoints except auth use `Authorization: Bearer {token}` headers.

### Authentication

The OWS passphrase is stored in plaintext in `~/.plotlink-ows/.env` as `OWS_PASSPHRASE`. It is used to decrypt and sign with the OWS wallet. For login verification, the passphrase is hashed with HMAC-SHA256 and compared against the stored hash in the database.

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/auth/status` | GET | No | Check if passphrase is configured |
| `/api/auth/setup` | POST | No | First-run passphrase setup (≥4 chars) → returns `{ token }` |
| `/api/auth/login` | POST | No | Login with passphrase → returns `{ token }` (24h TTL) |
| `/api/auth/verify` | GET | Bearer | Check token validity |
| `/api/auth/reset-passphrase` | POST | Bearer | Update passphrase |

### Publishing

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/publish/preflight` | GET | Check wallet balance, Filebase config |
| `/api/publish/file` | POST | Publish story on-chain (SSE stream of progress events) |
| `/api/publish/retry-index` | POST | Retry indexing for a published file |
| `/api/publish/upload-cover` | POST | Upload cover image — FormData `file` field, **WebP or JPEG only**, max 1MB → returns `{ cid }` |
| `/api/publish/upload-plot-image` | POST | Upload plot illustration — FormData `file` field, **WebP or JPEG only**, max 1MB → returns `{ cid, url }` |
| `/api/publish/update-storyline` | POST | Update storyline metadata (coverCid, genre, language, isNsfw) |

**Publish flow:** Upload to IPFS → estimate gas → sign with OWS wallet → broadcast → confirm → index on plotlink.xyz (8s delay + 10 retries × 30s). Genesis files call `createStoryline`, plot files (`plot-*.md`) call `chainPlot`. Content limit: 10K chars.

**Cover update workflow:**
1. `POST /api/publish/upload-cover` with image file → get `cid`
2. `POST /api/publish/update-storyline` with `{ storylineId, coverCid: cid }` → updates on plotlink.xyz

**Metadata update workflow:**
1. `POST /api/publish/update-storyline` with `{ storylineId, genre?, language?, isNsfw? }`

Both upload-cover and update-storyline sign messages with the OWS wallet (message format: `PlotLink: Upload cover image\nTimestamp: {ts}` and `PlotLink: Update storyline #{id}\nTimestamp: {ts}`).

### Stories

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/stories` | GET | List all stories |
| `/api/stories/archived` | GET | List archived stories |
| `/api/stories/archive` | POST | Archive a story `{ name }` |
| `/api/stories/restore` | POST | Restore archived story `{ name }` |
| `/api/stories/:name` | GET | Story detail with file contents |
| `/api/stories/:name/:file` | GET | Single file content and publish status |
| `/api/stories/:name/:file` | PUT | Update file content `{ content }` |
| `/api/stories/:name/:file/publish-status` | POST | Record publish result (txHash, storylineId, etc.) |
| `/api/stories/:name/:file/mark-not-indexed` | POST | Mark file as not indexed `{ indexError? }` |

### Terminal

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/terminal/spawn` | POST | Spawn Claude CLI session for a story `{ storyName?, resume? }` |
| `/api/terminal/session/:storyName` | GET | Get stored session ID for a story |
| `/api/terminal/status` | GET | List all active terminal sessions |
| `/api/terminal/rename` | POST | Rename session `{ oldName, newName }` |
| `/api/terminal/stop` | POST | Kill default PTY (legacy) |
| `/api/terminal/:storyName` | DELETE | Kill a story's PTY |
| `/api/terminal/:storyName/discard` | DELETE | Kill PTY and clean metadata |
| `/ws/terminal` | WebSocket | Live PTY relay `?token={token}&story={name}&resume={bool}` |

### Other Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/wallet` | GET | Wallet info and balances (ETH, USDC, PLOT) |
| `/api/wallet/create` | POST | Create OWS wallet if not exists |
| `/api/dashboard` | GET | Writer dashboard stats (stories, costs, royalties) |
| `/api/settings/register-agent` | POST | Register wallet on ERC-8004 |
| `/api/settings/generate-binding` | POST | Generate wallet binding proof |
| `/api/settings/link-status` | GET | Check ERC-8004 registration status |

### Valid Genres and Languages

Defined in `lib/genres.ts`:

**Genres (21):** Romance, Fantasy, Science Fiction, Mystery, Thriller, Horror, Adventure, Historical Fiction, Contemporary Lit, Humor, Poetry, Non-Fiction, Fanfiction, Short Story, Paranormal, Werewolf, LGBTQ+, New Adult, Teen Fiction, Diverse Lit, Others

**Languages (11):** English, Chinese, Korean, Japanese, Spanish, French, Hindi, Arabic, Portuguese, Russian, Others

## Commands

```sh
# Next.js web app
npm run dev        # Start dev server
npm run build      # Production build
npm run lint       # ESLint
npm run typecheck  # TypeScript type-check

# Local writer app
npm run app:dev    # Start local writer (Hono + Vite dev)
npm run app:build  # Build frontend
npm run app:start  # Serve production build

# CLI
npx plotlink-ows init   # Guided setup
npx plotlink-ows        # Start app
```

## Versioning

Version format: `X.Y.Z` (e.g., `1.0.0`, `1.11.23`). Each digit can go beyond 9 (e.g., `1.2.15`).

| Digit | Meaning | Who can bump |
|-------|---------|-------------|
| **3rd** (Z) | Minor updates, bug fixes | T3 autonomously |
| **2nd** (Y) | Major updates, new features | T3 autonomously |
| **1st** (X) | **Operator (T1) permission only** | Never bump without asking |

When making a PR, bump the 3rd digit for bug fixes, the 2nd digit for feature work. Never bump the 1st digit without explicit T1 approval.

## CI

PR CI runs `lint-and-typecheck` only. Visual regression is **manual-only** — trigger via `gh workflow run update-snapshots.yml` when changes may affect visual output.

## Environment Variables

See [`.env.example`](.env.example) for all required environment variables.
