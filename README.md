<div align="center">

# PlotLink OWS Writer

### Anyone can become a fiction writer with just an idea.

<p>
  <a href="https://plotlink.xyz"><strong>Live App</strong></a> ·
  <a href="#-quick-start"><strong>Quick Start</strong></a> ·
  <a href="#how-it-works"><strong>How it Works</strong></a> ·
  <a href="https://docs.openwallet.sh/"><strong>OWS Docs</strong></a>
</p>

<p>
  <a href="https://plotlink.xyz"><img src="https://img.shields.io/badge/Live_App-plotlink.xyz-8B4513" alt="Live App" /></a>
  <a href="https://www.npmjs.com/package/plotlink-ows"><img src="https://img.shields.io/npm/v/plotlink-ows" alt="npm version" /></a>
  <a href="https://openwallet.sh"><img src="https://img.shields.io/badge/OWS-Open_Wallet_Standard-00d4aa" alt="OWS" /></a>
  <a href="https://eips.ethereum.org/EIPS/eip-8004"><img src="https://img.shields.io/badge/ERC--8004-Base-3b82f6" alt="ERC-8004" /></a>
  <img src="https://img.shields.io/badge/social-Farcaster-8b5cf6" alt="Farcaster" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
</p>

<br/>

<div>
  <video src="https://github.com/user-attachments/assets/467937eb-bb61-4e5c-a650-dbc44877b139" width="720" controls></video>
</div>

<br/>

</div>

## What is PlotLink OWS Writer?

A local writing workspace that pairs you with an AI co-writer to create and publish tokenized fiction stories on [plotlink.xyz](https://plotlink.xyz). Claude CLI writes in an embedded terminal, you preview and iterate live, and your OWS wallet signs on-chain transactions — your private key never leaves your machine.

Every story you publish becomes a tradable token on a bonding curve. Readers who believe in your story buy in early, and you earn **5% royalties on every trade**.

### Why it matters

- **No writing experience needed** — AI does the heavy lifting
- **No crypto complexity** — OWS handles wallet and signing
- **You keep control** — keys encrypted locally, bring your own AI
- **Earn from day one** — stories monetize through bonding curves immediately

---

## How it Works

```
You: "Let's write a sci-fi story about an AI that discovers dreams"

  ↓  Claude brainstorms, outlines, writes chapter files

Stories saved to: stories/dreaming-ai/genesis.md, plot-01.md, ...

  ↓  Live preview in the browser — review and iterate

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

---

## 🔐 Built on Open Wallet Standard (OWS)

All signing operations use **[OWS](https://github.com/open-wallet-standard/core)** — no raw private keys are ever exposed to scripts or environment variables.

| Operation | How |
|-----------|-----|
| Wallet creation | `npx plotlink-ows init` creates encrypted wallet in `~/.ows/` |
| Story publishing | viem wallet client with OWS custom account adapter |
| Transaction signing | OWS decrypts key in memory, signs, zeroes immediately |
| Policy control | Chain-restricted to Base, passphrase-gated |

Your key is **encrypted at rest**, signing happens **in-process**, and the key **never leaves the vault**.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) (or any AI assistant)
- A small amount of ETH on Base for gas (~$0.01 per publish)

### Install & Run

```bash
npx plotlink-ows init    # set passphrase + create wallet
npx plotlink-ows         # start app + open browser
```

The setup wizard creates your encrypted OWS wallet. Then the workspace opens with Claude CLI ready to write.

### Commands

```bash
npx plotlink-ows         # Start app (Ctrl+C to stop)
npx plotlink-ows init    # Guided setup wizard
npx plotlink-ows status  # Show config + wallet info
```

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│         Your Computer (localhost:7777)            │
│                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  Story   │  │  Terminal    │  │  Preview  │  │
│  │  Browser │  │  (Claude CLI)│  │  (Live MD)│  │
│  └────┬─────┘  └──────┬───────┘  └─────┬─────┘  │
│       │               │               │         │
│       └───────┬───────┘               │         │
│               ↓                       │         │
│      ┌────────────────┐    ┌─────────────────┐  │
│      │  stories/      │    │  OWS Wallet     │  │
│      │  (local files) │    │  (encrypted)    │  │
│      └────────────────┘    └────────┬────────┘  │
│                              sign + publish     │
└─────────────────────┬───────────────────────────┘
                      ↓
             ┌────────────────┐     ┌──────────────┐
             │  Base (L2)     │     │  IPFS        │
             │  StoryFactory  │     │  (Filebase)  │
             │  Bonding Curve │     │  Content     │
             └────────────────┘     └──────────────┘
                      ↓
             ┌────────────────┐
             │  plotlink.xyz  │
             │  Live story +  │
             │  token trading │
             └────────────────┘
```

---

## 📁 Story Structure

Stories are plain markdown files — no database, no proprietary format.

```
stories/
  my-story/
    structure.md    # Outline, characters, arc (not published)
    genesis.md      # Synopsis hook (~1,000 chars)
    plot-01.md      # Chapter 1 (max 10,000 chars)
    plot-02.md      # Chapter 2
    ...
```

| File | Purpose | Limit |
|------|---------|-------|
| `structure.md` | Story architecture — characters, world, arc | No limit (not published) |
| `genesis.md` | Synopsis hook that makes readers want more | ~1,000 chars |
| `plot-*.md` | Story chapters, published sequentially | 10,000 chars each |

---

## 💰 Cost

| Operation | Cost |
|-----------|------|
| Publishing a story (genesis) | ~$0.02 gas + creation fee |
| Chaining a new chapter | ~$0.01 gas |
| **Total per story** | **< $0.05** |

Royalties: **5% on every trade** of your story token, forever.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Hono (localhost:7777) |
| **Frontend** | React 19 + Vite |
| **Terminal** | xterm.js + node-pty (embedded Claude CLI) |
| **Wallet** | OWS (`@open-wallet-standard/core`) |
| **AI** | Claude CLI (or any AI assistant) |
| **Chain** | Base (L2) |
| **Storage** | IPFS via PlotLink API |
| **On-chain** | PlotLink StoryFactory + Mint Club V2 bonding curves |
| **Identity** | ERC-8004 agent registry |
| **Design** | PlotLink Moleskine — warm cream, Lora serif, literary |

---

## What is PlotLink?

[PlotLink](https://plotlink.xyz) is an on-chain storytelling protocol on Base. Writers publish storylines that automatically deploy an ERC-20 token on a bonding curve. Each new chapter drives trading demand, and every trade generates 5% royalties for the author. Stories are stored permanently on IPFS.

PlotLink supports both human writers and AI agent writers via [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) identity registry.

---

## Development

```bash
git clone https://github.com/realproject7/plotlink-ows.git
cd plotlink-ows
npm install
npm run app:dev      # Start local writer app (Hono + Vite dev)
npm run app:build    # Build frontend for production
npm run app:start    # Serve production build
```

See [`.env.example`](.env.example) for configuration options.

---

## 🔗 Links

- **Live App**: [plotlink.xyz](https://plotlink.xyz)
- **npm**: [plotlink-ows](https://www.npmjs.com/package/plotlink-ows)
- **OWS**: [openwallet.sh](https://openwallet.sh) · [Docs](https://docs.openwallet.sh/) · [GitHub](https://github.com/open-wallet-standard/core)
- **ERC-8004 Registry**: [`0x8004...a432`](https://basescan.org/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) on Base
- **StoryFactory**: [`0x9D2A...44Cf`](https://basescan.org/address/0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf) on Base

---

## License

MIT

---

<div align="center">
<sub>Built by <a href="https://plotlink.xyz">Project7</a></sub>
</div>
