/**
 * Tx hash validation for real-time indexer endpoints.
 *
 * Prevents DoS by rejecting stale tx hashes before expensive processing.
 * Uses getReceiptWithRetry for load-balanced RPC reliability, then checks
 * block timestamp recency.
 */

import { type Hex } from "viem";
import { publicClient, getReceiptWithRetry } from "./rpc";

const MAX_TX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Validate that a tx hash corresponds to a real, recent, successful transaction.
 * Uses retry logic for load-balanced RPC nodes.
 * Returns the receipt if valid, or null if the tx is missing/failed/stale.
 */
export async function validateRecentTx(txHash: Hex) {
  try {
    const receipt = await getReceiptWithRetry(txHash);
    if (!receipt || receipt.status !== "success") return null;

    // Check recency via block timestamp
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const txAgeMs = Date.now() - Number(block.timestamp) * 1000;
    if (txAgeMs > MAX_TX_AGE_MS) return null;

    return receipt;
  } catch {
    return null;
  }
}
