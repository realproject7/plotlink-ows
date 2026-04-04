/**
 * ZapPlotLinkV2 frontend wrappers.
 *
 * Multi-token zap: ETH/USDC/HUNT → PLOT → storyline token in one tx.
 * The contract handles the full swap path internally — no V4 Quoter
 * calls needed from the frontend.
 */

import { type Address, parseAbi } from "viem";
import { browserClient as publicClient } from "./rpc";
import { ZAP_PLOTLINK, ETH_ADDRESS } from "./contracts/constants";

// ---------------------------------------------------------------------------
// ABI — ZapPlotLinkV2 (multi-token interface)
// ---------------------------------------------------------------------------

export const zapPlotLinkV2Abi = parseAbi([
  "function mint(address fromToken, address storylineToken, uint256 storylineAmount, uint256 maxFromTokenAmount) external payable returns (uint256 fromTokenUsed)",
  "function mintReverse(address fromToken, address storylineToken, uint256 fromTokenAmount, uint256 minStorylineAmount) external payable returns (uint256 storylineAmount)",
  "function estimateMint(address fromToken, address storylineToken, uint256 storylineAmount) external returns (uint256 fromTokenAmount, uint256 totalPlotRequired)",
  "function estimateMintReverse(address fromToken, address storylineToken, uint256 fromTokenAmount) external returns (uint256 storylineAmount, uint256 plotAmount)",
]);

const SLIPPAGE_BPS = 300; // 3% slippage buffer for bonding curve

// ---------------------------------------------------------------------------
// Quote types
// ---------------------------------------------------------------------------

export type ZapMode = "exact-output" | "exact-input";

export interface ZapQuote {
  /** fromToken amount needed (exact-output) or spent (exact-input) */
  fromTokenAmount: bigint;
  /** PLOT tokens involved in the bonding curve leg */
  plotAmount: bigint;
  /** For exact-input: estimated storyline tokens received */
  tokensOut?: bigint;
  mode: ZapMode;
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

/**
 * Get a quote for a zap mint. Calls the contract's non-view estimate
 * functions via simulateContract (eth_call).
 *
 * @param fromToken Input token address (address(0) for ETH)
 * @param storylineToken Storyline token to mint
 * @param amount Storyline tokens (exact-output) or fromToken amount (exact-input)
 * @param mode Quote mode
 */
export async function getZapQuote(
  fromToken: Address,
  storylineToken: Address,
  amount: bigint,
  mode: ZapMode,
): Promise<ZapQuote> {
  if (mode === "exact-output") {
    const { result } = await publicClient.simulateContract({
      address: ZAP_PLOTLINK,
      abi: zapPlotLinkV2Abi,
      functionName: "estimateMint",
      args: [fromToken, storylineToken, amount],
    });

    const fromTokenAmount = result[0];
    const plotRequired = result[1];

    // Add 3% slippage buffer to fromTokenAmount
    const withSlippage = fromTokenAmount + (fromTokenAmount * BigInt(SLIPPAGE_BPS)) / BigInt(10000);

    return { fromTokenAmount: withSlippage, plotAmount: plotRequired, mode };
  } else {
    const { result } = await publicClient.simulateContract({
      address: ZAP_PLOTLINK,
      abi: zapPlotLinkV2Abi,
      functionName: "estimateMintReverse",
      args: [fromToken, storylineToken, amount],
    });

    const tokensOut = result[0];
    const plotAmount = result[1];

    return { fromTokenAmount: amount, plotAmount, tokensOut, mode };
  }
}

// ---------------------------------------------------------------------------
// Transaction builder
// ---------------------------------------------------------------------------

/**
 * Build wagmi-compatible transaction params for a zap mint.
 *
 * - ETH: payable tx with msg.value, no prior approval needed
 * - USDC/HUNT: non-payable tx, requires prior ERC-20 approval to ZAP_PLOTLINK
 *
 * @param fromToken Input token address (address(0) for ETH)
 * @param storylineToken Storyline token to mint
 * @param amount Storyline tokens (exact-output) or fromToken amount (exact-input)
 * @param mode Zap mode
 * @param quote The quote from getZapQuote
 */
export function buildZapMintTx(
  fromToken: Address,
  storylineToken: Address,
  amount: bigint,
  mode: ZapMode,
  quote: ZapQuote,
) {
  const isEth = fromToken === ETH_ADDRESS;

  if (mode === "exact-output") {
    return {
      address: ZAP_PLOTLINK,
      abi: zapPlotLinkV2Abi,
      functionName: "mint" as const,
      args: [fromToken, storylineToken, amount, quote.fromTokenAmount] as const,
      value: isEth ? quote.fromTokenAmount : BigInt(0),
      gas: BigInt(5_000_000),
    };
  } else {
    // Apply 3% slippage to minStorylineAmount
    const minOut = quote.tokensOut ?? BigInt(0);
    const slippageProtected = minOut > BigInt(0)
      ? minOut - (minOut * BigInt(SLIPPAGE_BPS)) / BigInt(10000)
      : BigInt(0);

    return {
      address: ZAP_PLOTLINK,
      abi: zapPlotLinkV2Abi,
      functionName: "mintReverse" as const,
      args: [fromToken, storylineToken, amount, slippageProtected] as const,
      value: isEth ? amount : BigInt(0),
      gas: BigInt(5_000_000),
    };
  }
}
