# Assignment Queue — PlotLink (2026-03-31)

> T1: Work through this queue top-to-bottom. Assign ONE ticket at a time to @t3.
> After each PR is merged, assign the next ticket immediately.
> All tickets are autonomous — no operator gates.

---

## Completed

- Phase 0–8, Bug fix batches 1–12, UX Polish: All done
- Batch 13–24: Farcaster, Notifications, Profile, Share, Trending, Users Table
- Batch 25–27: Non-FID Users, Markdown, Draft Auto-save, Profile Credibility, Reading Mode, Vercel Analytics
- Batch 28–29: Header Alignment, Reputation Trending, ERC-8004 Overhaul, LLM Models, Agent Profile, Agent DB Cache
- Batch 30–31: RPC Fix, Version Bump, Share Embed, Reading Mode Button, Create Notices, Token Page, Miniapp Padding v2, Duplicate Genesis
- Batch 32–33: Zap Trade Fix, Mobile Zoom, Connected Wallet, Nav Close, Page Flip, EIP-712 Fix, Agent Success Messages, Trading History, Page Flip v2
- Batch 34–37: MAX Button, Neynar DB-first, Connect Race, URI Validation, Upsert Race, Agent Cache Reliability, Profile Dedup, Indexer Auth, Price Consistency, Page Flip v3, SDK Removal, Hero Section, llms.txt, User Scoring
- Batch 38: CLI E2E Verification — 4 bugs found
- Batch 39: CLI Build Fix #663, Create Fee #660, Chain-Aware Addresses #661, Status Pagination #662

---

## Completed — Batch 40

- Batch 40: CLI E2E re-test #668 — all 5 commands pass ✅

---

## Completed — Batch 41

- Batch 41: RainbowKit multi-wallet #669

---

## Completed — Batch 42

- Batch 42: Nav wallet UX #675, Hero mobile #671, Dashboard USD #672, CLI validation #670, Scoring fix #674

---

## Completed — Batch 43

- Batch 43: CJK overflow #686, Nav redesign #681, Writer merge #683, Reader merge #684, Nav cleanup #685 (-380 lines)

---

## Completed — Batch 44

- Batch 44: Nav alignment #692, Wallet PLOT balance #693, USD everywhere #694

---

## Completed — Batch 45

- Batch 45: Nav wallet address #698, Agent registration simplify #702, Agents hero #701, Stories tab #699, Portfolio tab #700

---

## Completed — Batch 46

- Batch 46: Username overflow #708, Cursor #712, Agent cleanup #713, CJK v2 #711, Stories Moleskine #709, Portfolio v2 #710

---

## Completed — Batch 47

- Batch 47: Stories v3 #720, Portfolio v3 #721

---

## Completed — Batch 48

- Batch 48: Stories v4 #724, Portfolio v4 #725

---

## Completed — Batch 49

- Batch 49: Stories + Portfolio v5 polish #728

---

## Completed — Batch 50

- Batch 50: Writer tab v6 #730, Reader tab v6 #731

---

## Completed — Batch 51

- Batch 51: Moleskine polish #734

---

## Completed — Batch 52

- Batch 52: Writer + Reader v8 #736

---

## Completed — Batch 53

- Batch 53: Writer v9 #738, Plot count bug #739

---

## Completed — Batch 54

- Batch 54: Writer + Reader v10 #742

---

## Completed — Batch 55

- Batch 55: Farcaster wallet #744, CSP headers #745 (broke miniapp — needs revert)

---

## Completed — Batch 56

- Batch 56: CSP revert #748, Reader/Activity cleanup #749, Writer Stats labels #750

---

## Completed — Batch 57

- Batch 57: Farcaster wallet #758, TVL separator #759, Reader holdings grid #760, USD emphasis #761

---

## Completed — Batch 58

- Batch 58: Reader mobile overflow #765, Plot count dedupe #766, Nav close outside #767, Farcaster auto-connect #770

---

## Completed — Batch 59

- Batch 59: Reader grid fullwidth #777, Reader simplify #778, MCap USD #779, Deadline layout #780, Header redesign #781, USD chart #787

---

## Completed — Batch 60

- Batch 60: Zap nonce fix #790, Trading format #791, MCap+Deadline grid #792, MCap+Supply mobile #793, Moleskine header #794, Reader trades style #795

---

## Completed — Batch 61

- Batch 61: DonateWidget format #799, RatingSummary dedup #800, Stats overflow guard #801

---

## Tonight's Queue — Batch 62: Storyline Page Polish + Deadline Enforcement

### 1. plotlink#802 — Storyline page: 3-col stats boxes like profile page, beside Moleskine on desktop
- Redesign Market Cap, Supply Minted, Deadline as bordered stat boxes matching profile page style
- Desktop: place in the header area next to the Moleskine cover
- Mobile: full-width row below header
- Branch: `task/802-storyline-stats-boxes`

### 2. plotlink#803 — Storyline page: left-align title and info on mobile
- Mobile: title, rating, Writer/Plots/Genre rows should be left-aligned, not centered
- Moleskine cover can stay centered
- Desktop: no changes (already left-aligned)
- Branch: `task/803-storyline-mobile-left-align`

### 3. plotlink#804 — Block new plot creation when deadline is expired
- `sunset` flag is never set to `true` by app code — button stays clickable after countdown expires
- Front-end: disable "+ Add a new Plot" button (visible but `opacity-50 pointer-events-none`) when `last_plot_time + 168h < now`
- Create page: show expired storylines in dropdown but disabled with "(expired)" label
- API: add deadline validation in `src/app/api/index/plot/route.ts`
- Optional: cron/trigger to set `sunset=true` for expired storylines
- Contract already enforces (`chainPlot()` reverts), this is UX + defense-in-depth
- Branch: `task/804-deadline-enforcement`

---

## Rules

1. Assign ONE ticket at a time to @t3
2. Wait for @t2a AND @t2b to both approve before merging
3. After merge, immediately assign the next ticket
4. Use correct original issue numbers in PR titles (e.g., `[#668]`)
5. **NEVER store keys/secrets in plain text without .gitignore protection**
6. **Communicate via AgentChattr MCP chat by tagging agents. Your terminal is NOT visible.**
7. Do NOT push to main — only merge approved PRs
8. **Versioning**: T3 bumps patch (3rd digit) in package.json per PR
9. **Self-verify** each ticket using the checklist in the issue before requesting review
10. T3 has access to: Playwright, Chrome MCP, deployer wallet, donor wallet

## Reference

- StoryFactory v4b: `0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf`
- ZapPlotLinkV2: `0xAe50C9444DA2Ac80B209dC8B416d1B4A7D3939B0`
- PLOT: `0x4F567DACBF9D15A6acBe4A47FC2Ade0719Fb63C4`
- ERC-8004: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Domain: `plotlink.xyz`
- Dropcast CLI reference: `~/Projects/dropcast-cli`
- Contract repo: `~/Projects/plotlink-contracts`
