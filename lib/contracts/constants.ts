/**
 * Contract addresses and chain configuration for PlotLink on Base.
 *
 * Source: proposal §12 (External Dependencies).
 *
 * Testnet (Base Sepolia) addresses are active during development.
 * Swap to mainnet addresses before production deployment.
 */

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "84532");
export const IS_TESTNET = chainId === 84532;
export const BASE_CHAIN_ID = chainId;

/** Block explorer base URL (no trailing slash) */
export const EXPLORER_URL = IS_TESTNET
  ? "https://sepolia.basescan.org"
  : "https://basescan.org";

// ---------------------------------------------------------------------------
// PlotLink contracts
// ---------------------------------------------------------------------------

/** Deployment block for the v4b StoryFactory (symbol-collision fix) on Base mainnet */
export const DEPLOYMENT_BLOCK = BigInt(43_840_298);

/** StoryFactory — storyline + plot management */
export const STORY_FACTORY = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
  (IS_TESTNET
    ? "0xfa5489b6710Ba2f8406b37fA8f8c3018e51FA229"
    : "0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf")) as `0x${string}`;

/** ZapPlotLinkV2 — one-click buy (ETH/USDC/HUNT -> PLOT -> storyline token via Uniswap V4 + MCV2)
 *  Testnet: disabled (V1 contract incompatible with V2 ABI) */
export const ZAP_PLOTLINK = (IS_TESTNET
  ? "0x0000000000000000000000000000000000000000"
  : "0xAe50C9444DA2Ac80B209dC8B416d1B4A7D3939B0") as `0x${string}`;

/** $PLOT protocol token (backed by $HUNT via Mint Club V2) */
export const PLOT_TOKEN = (IS_TESTNET
  ? "0x6Ef4A3f654F2AfcEa8A8704D61Be5271536c13Fa"
  : "0x4F567DACBF9D15A6acBe4A47FC2Ade0719Fb63C4") as `0x${string}`;

/** Human-readable label for the reserve token */
export const RESERVE_LABEL = "PLOT";

// ---------------------------------------------------------------------------
// Supported Zap input tokens (Base)
// ---------------------------------------------------------------------------

/** 1inch Spot Price Aggregator on Base */
export const ONEINCH_SPOT_PRICE_AGGREGATOR = "0x00000000000D6FFc74A8feb35aF5827bf57f6786" as const;

/** USDC on Base */
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/** HUNT on Base */
export const HUNT = "0x37f0c2915CeCC7e977183B8543Fc0864d03E064C" as const;

/** ETH represented as address(0) in the Zap contract */
export const ETH_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** Supported input tokens for the Zap UI selector */
export const SUPPORTED_ZAP_TOKENS = [
  { symbol: "ETH", address: ETH_ADDRESS as `0x${string}`, decimals: 18 },
  { symbol: "USDC", address: USDC as `0x${string}`, decimals: 6 },
  { symbol: "HUNT", address: HUNT as `0x${string}`, decimals: 18 },
] as const;

// ---------------------------------------------------------------------------
// Mint Club V2
// ---------------------------------------------------------------------------

/** MCV2_Bond — bonding curve trading, token creation, royalty distribution */
export const MCV2_BOND = (IS_TESTNET
  ? "0x5dfA75b0185efBaEF286E80B847ce84ff8a62C2d"
  : "0xc5a076cad94176c2996B32d8466Be1cE757FAa27") as `0x${string}`;

/** MCV2_BondPeriphery — reverse calculations for mint() */
export const MCV2_BOND_PERIPHERY = (IS_TESTNET
  ? "0x20fBC8a650d75e4C2Dab8b7e85C27135f0D64e89"
  : "0x492C412369Db76C9cdD9939e6C521579301473a3") as `0x${string}`;

// ---------------------------------------------------------------------------
// Uniswap V4 (Base)
// ---------------------------------------------------------------------------

/** PoolManager — V4 core pool operations */
export const UNISWAP_V4_POOL_MANAGER = "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408" as const;

/** Universal Router — swap execution */
export const UNISWAP_V4_ROUTER = "0x6fF5693b99212Da76ad316178A184AB56D299b43" as const;

/** Quoter — price estimation for frontend quotes */
export const UNISWAP_V4_QUOTER = "0x0d5e0F971ED27FBfF6c2837bf31316121532048D" as const;

/** Permit2 — gasless token approvals */
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

// ---------------------------------------------------------------------------
// ERC-8004 Agent Identity (Base)
// ---------------------------------------------------------------------------

/** Agent Registry — agent writer identity NFTs and reputation */
export const ERC8004_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
