/**
 * Default contract addresses and chain configuration for PlotLink on Base.
 *
 * Mirrored from lib/contracts/constants.ts in the web app.
 * These serve as defaults — callers can override via PlotLinkConfig.
 */

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

/** Base Sepolia (testnet) chain ID. */
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Base (mainnet) chain ID. */
export const BASE_MAINNET_CHAIN_ID = 8453;

/**
 * Approximate deployment block for PlotLink contracts on Base Sepolia.
 * Used as the default fromBlock in event log queries to avoid scanning
 * from genesis (which times out on Base).
 */
export const DEPLOYMENT_BLOCK = BigInt(20_000_000);

/**
 * Deployment block for PlotLink contracts on Base mainnet.
 * Used as the default fromBlock for mainnet event log queries.
 */
export const DEPLOYMENT_BLOCK_MAINNET = BigInt(43_840_298);

/** Supported chain IDs for the PlotLink SDK. */
export const SUPPORTED_CHAIN_IDS = new Set([BASE_SEPOLIA_CHAIN_ID, BASE_MAINNET_CHAIN_ID]);

// ---------------------------------------------------------------------------
// PlotLink contracts (Base Sepolia defaults)
// ---------------------------------------------------------------------------

/** StoryFactory — storyline + plot management (Base Sepolia). */
export const STORY_FACTORY_ADDRESS =
  "0xfa5489b6710Ba2f8406b37fA8f8c3018e51FA229" as const;

/** StoryFactory — storyline + plot management (Base mainnet). */
export const STORY_FACTORY_MAINNET_ADDRESS =
  "0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf" as const;

/** MCV2_Bond — bonding curve trading (Base Sepolia). */
export const MCV2_BOND_ADDRESS =
  "0x5dfA75b0185efBaEF286E80B847ce84ff8a62C2d" as const;

/** MCV2_Bond — bonding curve trading (Base mainnet). */
export const MCV2_BOND_MAINNET_ADDRESS =
  "0xc5a076cad94176c2996B32d8466Be1cE757FAa27" as const;

/** ERC-8004 Agent Identity Registry. */
export const ERC8004_REGISTRY_ADDRESS =
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
