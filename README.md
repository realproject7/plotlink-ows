# PlotLink OWS Writer

[![npm version](https://img.shields.io/npm/v/plotlink-ows)](https://www.npmjs.com/package/plotlink-ows)

**Anyone can become a fiction writer with just an idea.**

```bash
npx plotlink-ows init    # one-time setup (~2 minutes)
npx plotlink-ows         # start writing
```

PlotLink OWS Writer is a local writing workspace that turns your ideas into published, tokenized fiction stories on [plotlink.xyz](https://plotlink.xyz). You write stories with Claude CLI (or any AI assistant) in an embedded terminal, preview them live, and publish on-chain with one click. Every story becomes a tradable token on a bonding curve, earning you royalties from every trade.

No writing experience needed. No crypto complexity. Just an idea and a conversation with your AI co-writer.

## How It Works

```
You: "Let's write a sci-fi story about an AI that discovers it can dream"

  ↓  Claude CLI brainstorms, outlines, writes chapter files

Stories saved to: stories/dreaming-ai/genesis.md, plot-01.md, ...

  ↓  Live preview in the browser — you review and iterate

  ↓  Click "Publish" on any chapter

On-chain: Story published to PlotLink on Base
          → Token + bonding curve deployed
          → You earn 5% royalties on every trade
```

### The Flow

1. **Setup** — `npx plotlink-ows init` (passphrase + OWS wallet)
2. **Start** — `npx plotlink-ows` opens the three-panel workspace
3. **Write** — Claude CLI runs in the embedded terminal, creating story files
4. **Preview** — Live markdown preview auto-refreshes as Claude writes
5. **Publish** — Click publish on any chapter to go on-chain via your OWS wallet
6. **Earn** — Your story is live on [plotlink.xyz](https://plotlink.xyz) with a bonding curve

## Architecture

```
┌──────────────────────────────────────────────────┐
│         Your Computer (localhost:7777)            │
│                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  Story   │  │  Terminal    │  │  Preview  │  │
│  │  Browser │  │  (Claude CLI)│  │  (Live MD)│  │
│  │          │  │              │  │           │  │
│  └────┬─────┘  └──────┬───────┘  └─────┬─────┘  │
│       │               │               │         │
│       └───────┬───────┘               │         │
│               ↓                       │         │
│      ┌────────────────┐    ┌─────────────────┐  │
│      │  stories/      │    │  OWS Wallet     │  │
│      │  (local files) │    │  (encrypted)    │  │
│      └────────────────┘    └────────┬────────┘  │
│                                     │           │
│               sign tx + publish ────┘           │
└─────────────────┬───────────────────────────────┘
                  ↓
         ┌────────────────┐     ┌─────────────────┐
         │  Base (L2)     │     │  IPFS           │
         │  StoryFactory  │     │  (Filebase)     │
         │  Bonding Curve │     │  Story content  │
         └────────────────┘     └─────────────────┘
                  ↓
         ┌────────────────┐
         │  plotlink.xyz  │
         │  Live story +  │
         │  token trading │
         └────────────────┘
```

## What is PlotLink?

[PlotLink](https://plotlink.xyz) is an on-chain storytelling protocol on Base. Writers publish storylines that automatically deploy an ERC-20 token on a bonding curve. Each new chapter drives trading demand, and every trade generates 5% royalties for the author. Stories are stored permanently on IPFS.

## What is OWS?

[Open Wallet Standard](https://docs.openwallet.sh/) is an open standard for local wallet storage and policy-gated signing. Your private key is encrypted on your machine — the app signs transactions through OWS without ever seeing the key.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Hono (localhost:7777) |
| **Frontend** | React 19 + Vite |
| **Terminal** | xterm.js + node-pty (embedded Claude CLI) |
| **Database** | SQLite + Prisma (auth sessions) |
| **Wallet** | OWS (`@open-wallet-standard/core`) |
| **AI** | Claude CLI (or any AI assistant in the terminal) |
| **Chain** | Base (L2) |
| **Storage** | IPFS via Filebase |
| **On-chain** | PlotLink StoryFactory + Mint Club V2 bonding curves |
| **Design** | PlotLink Moleskine aesthetic — warm cream, serif headings, literary |

## Getting Started

### Prerequisites

- Node.js 20+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) (or any AI CLI)
- A small amount of ETH on Base for gas (~$0.01 per publish)

### Quick Start

```bash
npx plotlink-ows init    # set passphrase + create wallet
npx plotlink-ows         # start app + open browser
```

The setup wizard creates your encrypted OWS wallet. Then the workspace opens with Claude CLI ready to write.

### Commands

```bash
npx plotlink-ows         # Start app + open browser
npx plotlink-ows init    # Guided setup wizard
npx plotlink-ows stop    # Stop the server
npx plotlink-ows status  # Show config + wallet + server status
```

### Development

```bash
git clone https://github.com/realproject7/plotlink-ows.git
cd plotlink-ows
npm install
npm run app:dev      # Start local writer app (Hono + Vite dev)
npm run app:build    # Build for production
npm run app:start    # Serve production build
```

### Environment Variables

See [`.env.example`](.env.example) for configuration options.

## Links

- **Live app**: [plotlink.xyz](https://plotlink.xyz)
- **OWS docs**: [docs.openwallet.sh](https://docs.openwallet.sh/)
- **OWS SDK**: [github.com/open-wallet-standard/core](https://github.com/open-wallet-standard/core)
