# PlotLink

On-chain storytelling protocol. Writers tokenise their storylines on a bonding curve from day 1 — every new plot drives trading, and every trade generates royalties for the author. Story artifacts stored on IPFS via Filebase. The app is mobile-first with a terminal/monospace design aesthetic.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Auth & Database**: Supabase
- **Storage**: Filebase (IPFS)
- **Chain**: EVM-compatible (RPC + contract interaction)

## Repo Structure

```
src/
  app/          # Next.js App Router pages and layouts
    globals.css # Design tokens (CSS custom properties)
    layout.tsx  # Root layout (monospace font)
    page.tsx    # Home page
.github/
  workflows/
    ci.yml      # Lint + type-check on PRs
```

## Commands

```sh
npm run dev        # Start dev server
npm run build      # Production build
npm run lint       # ESLint
npm run typecheck  # TypeScript type-check (tsc --noEmit)
```

## Design System

Terminal aesthetic: dark background (`#0a0a0a`), monospace font (Geist Mono), green accent (`#00ff88`), outline-based UI. CSS custom properties defined in `src/app/globals.css`.

## Proposal

The full project proposal will be added at `docs/PROPOSAL-plotlink.md` in a future ticket.

## Versioning

Version is tracked in `package.json` and displayed in the footer. All agents must follow these rules:

| Digit | Meaning | Who can bump |
|-------|---------|-------------|
| **3rd** (patch) | Bug fixes, minor updates | T3 autonomously |
| **2nd** (minor) | Feature additions, major updates | **Operator (T1) permission required** |
| **1st** (major) | Pivot-level changes | **Operator (T1) permission required** |

When making a PR, bump the patch version in `package.json` for bug fixes. For feature work, note in the PR that a minor version bump may be needed and let T1 decide.

## Environment Variables

See [`.env.example`](.env.example) for all required environment variables.
