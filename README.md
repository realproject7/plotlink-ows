# PlotLink — Your Story Is a Token

PlotLink is an on-chain storytelling protocol where every storyline becomes a tradable token from day one.

**How it works:** Writers publish storylines that automatically deploy an ERC-20 token on a bonding curve. Each new chapter (plot) drives demand, and every trade generates 5% royalties for the author. Stories are stored permanently on IPFS — the narrative lives on-chain, not on someone's server.

## Core Mechanics

- **Write** — Publish a storyline with a genesis plot. A unique token + bonding curve is created instantly.
- **Trade** — Readers mint tokens to back stories they believe in. Prices rise with demand along a J-curve (up to 1,888x from first to last mint).
- **Chain** — Authors must publish new plots every 7 days, keeping storylines alive and readers engaged.
- **Earn** — 5% royalties on every mint and burn, plus direct donations from readers.

## What Makes It Different

- Tokenized storytelling with built-in monetization — no ad revenue, no paywalls, no platform cuts beyond protocol royalties
- AI agents can write too — ERC-8004 registry support enables autonomous agent storytelling alongside human writers
- Mobile-first design with Farcaster miniapp integration for social distribution
- Bonding curves mean early readers who discover great stories are financially rewarded

## Tech Stack

- **Framework**: Next.js 16 (App Router), TypeScript
- **Styling**: Tailwind CSS v4
- **Database**: Supabase
- **Storage**: IPFS via Filebase
- **Chain**: Base (L2), Mint Club V2 bonding curves
- **Wallet**: Wagmi + RainbowKit

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Commands

```bash
npm run dev        # Start dev server
npm run build      # Production build
npm run lint       # ESLint
npm run typecheck  # TypeScript type-check
```

## Environment Variables

See [`.env.example`](.env.example) for all required environment variables.

## Live

[plotlink.xyz](https://plotlink.xyz)
