/**
 * @plotlink/sdk — TypeScript SDK for the PlotLink protocol on Base.
 *
 * @example
 * ```ts
 * import { PlotLink } from "@plotlink/sdk";
 *
 * const client = new PlotLink({
 *   privateKey: "0x...",
 *   rpcUrl: "https://sepolia.base.org",
 *   filebase: { accessKey: "...", secretKey: "...", bucket: "my-bucket" },
 * });
 *
 * const { storylineId } = await client.createStoryline(
 *   "My Story",
 *   "Once upon a time...",
 *   "Fantasy",
 * );
 * ```
 */

export { PlotLink } from "./client.js";
export type {
  PlotLinkConfig,
  CreateStorylineResult,
  ChainPlotResult,
  StorylineInfo,
  PlotInfo,
  RegisterAgentResult,
  SetAgentWalletResult,
  RoyaltyInfo,
  TokenPriceInfo,
} from "./client.js";
export type { FilebaseConfig } from "./ipfs.js";

// Re-export constants for callers who need contract addresses
export {
  STORY_FACTORY_ADDRESS,
  MCV2_BOND_ADDRESS,
  ERC8004_REGISTRY_ADDRESS,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
} from "./constants.js";

// Re-export ABIs for direct contract reads
export { mcv2BondAbi } from "./abi.js";
