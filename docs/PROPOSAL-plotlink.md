# PlotLink — Technical Proposal

> Version 5.1 — 2026-03-14
> Updated with Base Sepolia gas measurements from P2-7

---

## §4.1 Content Storage & Indexing

### Write Flow Cost Table

| Step | Action | Cost |
|------|--------|------|
| 1 | Upload content to IPFS (Filebase) | Free (Filebase plan) |
| 2 | `createStoryline()` on Base | ~14,282,950 gas |
| 3 | `chainPlot()` on Base | ~39,826 gas |
| 4 | Inline indexer call | Free (server-side) |

### Gas Cost Estimates (Base Sepolia, measured)

At Base L2 gas prices (~0.01 gwei effective), estimated costs:

| Function | Gas | Est. Cost (ETH) | Est. Cost (USD @ $2,500/ETH) |
|----------|-----|------------------|------------------------------|
| `createStoryline()` | 14,282,950 | ~0.000143 | ~$0.00036 |
| `chainPlot()` | 39,826 | ~0.0000004 | ~$0.000001 |

> Note: `createStoryline()` gas is dominated by `MCV2_Bond.createToken()` which deploys a new ERC20 token and stores 500 bonding curve steps on-chain. This is a one-time cost per storyline. Subsequent `chainPlot()` calls are very cheap (~40k gas).

---

## §4.2 Contract System

### Architecture

PlotLink uses a single immutable contract — **StoryFactory** — deployed on Base. No admin, no owner, no upgrade mechanism.

**External Dependencies**:
- **MCV2_Bond** (Mint Club V2): Token creation and bonding curve management
- **WETH** (Base): Reserve token for bonding curves ($PLOT on mainnet)

### Deployed Addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| **StoryFactory** | `0x05C4d59529807316D6fA09cdaA509adDfe85b474` |
| MCV2_Bond | `0x5dfA75b0185efBaEF286E80B847ce84ff8a62C2d` |
| PLOT_TOKEN (WETH on testnet) | `0x4200000000000000000000000000000000000006` |

**Chain**: Base Sepolia (84532) — RPC: `https://sepolia.base.org`

---

## §4.3 StoryFactory

### Functions

#### `createStoryline(title, openingCID, openingHash, hasDeadline) → storylineId`

Creates a new storyline with a genesis plot on a Mint Club V2 bonding curve.

1. Validates title (non-empty) and CID (46–100 bytes)
2. Calls `MCV2_Bond.createToken()` with Mintpad Medium J-Curve parameters (500 steps)
3. Transfers creator role to `msg.sender` via `MCV2_Bond.updateBondCreator()`
4. Stores storyline metadata (writer, token, plotCount, lastPlotTime, hasDeadline)
5. Emits `StorylineCreated` and `PlotChained` (genesis) events

**Measured gas: 14,282,950** (Base Sepolia, TX `0x26f85ccdecb905d815a89a22f869913fbfc208a4f9486a63451cc840813b933e`)

> Gas breakdown: ~95% is `MCV2_Bond.createToken()` storing 500 bonding curve steps. The StoryFactory logic itself uses ~50k gas.

#### `chainPlot(storylineId, contentCID, contentHash)`

Chains a new plot to an existing storyline. Access-controlled to the storyline writer.

1. Validates writer identity (`msg.sender == writer`)
2. Validates CID length (46–100 bytes)
3. Checks storyline is not sunset
4. Enforces mandatory 7-day deadline (`block.timestamp <= lastPlotTime + 168 hours`)
5. Increments `plotCount` and updates `lastPlotTime`
6. Emits `PlotChained` event

**Measured gas: 39,826** (Base Sepolia, TX `0x50b8f1dc1bc9442966b3981fb9ed228b87489ee52cb0d1ec09433820e6dbe55e`)

> Constant gas cost regardless of storyline size — only writes to storage and emits one event.

#### `donate(storylineId, amount)`

Transfers $PLOT from donor to the storyline writer. Donor must have approved StoryFactory for $PLOT spending.

**Estimated gas: ~50,000** (ERC20 transferFrom + event emission)

### Events

```solidity
event StorylineCreated(
    uint256 indexed storylineId,
    address indexed writer,
    address tokenAddress,
    string title,
    bool hasDeadline,
    string openingCID,
    bytes32 openingHash
);

event PlotChained(
    uint256 indexed storylineId,
    uint256 indexed plotIndex,
    address indexed writer,
    string contentCID,
    bytes32 contentHash
);

event Donation(uint256 indexed storylineId, address indexed donor, uint256 amount);
```

### Storyline Struct

```solidity
struct Storyline {
    address writer;         // sole author, royalty recipient
    address token;          // storyline token address on Mint Club
    uint256 plotCount;      // total plots chained (genesis = 1)
    uint256 lastPlotTime;   // timestamp of last plot
    bool hasDeadline;       // mandatory 7-day deadline (always true)
    bool sunset;            // true if deadline expired
}
```

---

## §4.4 Gas Costs

### Summary Table

| Operation | Gas Used | Frequency | Notes |
|-----------|----------|-----------|-------|
| Deploy StoryFactory | 13,599,048 | Once | Includes 500-step bonding curve arrays in constructor |
| `createStoryline()` | 14,282,950 | Per storyline | Dominated by MCV2_Bond.createToken() |
| `chainPlot()` | 39,826 | Per plot | Constant — storage write + event |
| `donate()` | ~50,000 | Per donation | ERC20 transferFrom + event |

### Bonding Curve Parameters

| Parameter | Value |
|-----------|-------|
| Curve type | Mintpad Medium J-Curve |
| Step count | 500 |
| Steepness | 0.85 |
| Exponent | 4 (hyperbolic) |
| Max supply | 1,000,000 tokens (1e24 wei) |
| Initial price | 2e12 wei (~0.000002 WETH) |
| Final price | 3,776,484,204,130,853 wei (~0.00378 WETH) |
| Price multiplier | ~1,888× from first to last step |
| Mint royalty | 500 bps (5%) |
| Burn royalty | 500 bps (5%) |

### Gas Analysis

The `createStoryline()` gas cost of ~14.3M is high but acceptable:

- **Base L2 gas is cheap**: At ~0.01 gwei, this costs ~0.000143 ETH (~$0.00036)
- **One-time cost**: Only incurred when creating a new storyline
- **Block limit safe**: Base Sepolia block gas limit is 60M; fits in a single block
- **Dominated by MCV2_Bond**: The StoryFactory contract logic is ~50k gas; the remaining ~14.2M is Mint Club V2 creating a new ERC20 token contract and storing 500 bonding curve data points

The `chainPlot()` gas cost of ~40k is very efficient:
- Constant regardless of storyline length
- Writers can chain plots frequently with negligible cost
- Well below the original ~47k target estimate

### Measurement Methodology

Gas values were measured on Base Sepolia using Foundry's `forge script` with `--broadcast`. The deployment and measurement scripts are in `realproject7/plotlink-contracts`:
- `script/DeployBaseSepolia.s.sol` — deployment with curve generation
- `script/MeasureGas.s.sol` — createStoryline + chainPlot gas capture
- `docs/DEPLOYMENT-BASE-SEPOLIA.md` — full deployment artifact
