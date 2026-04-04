#!/usr/bin/env npx tsx
/**
 * Backfill trade_history.price_per_token with marginal price (priceForNextMint)
 * instead of the batch average that was previously stored.
 *
 * Usage:
 *   npx tsx scripts/backfill-trade-prices.ts
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { formatUnits } from "viem";
import { publicClient } from "../lib/rpc";
import { priceForNextMintFunction } from "../lib/contracts/abi";
import { MCV2_BOND } from "../lib/contracts/constants";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("=== Backfill Trade Prices ===");
  console.log(`MCV2_BOND: ${MCV2_BOND}`);

  const { data: trades, error: fetchError } = await supabase
    .from("trade_history")
    .select("id, token_address, block_number, price_per_token")
    .order("block_number", { ascending: true });

  if (fetchError) {
    console.error("Failed to fetch trades:", fetchError.message);
    process.exit(1);
  }

  if (!trades || trades.length === 0) {
    console.log("No trades to backfill.");
    return;
  }

  console.log(`Found ${trades.length} trades to backfill.`);

  let updated = 0;
  let failed = 0;

  for (const trade of trades) {
    try {
      const price = await publicClient.readContract({
        address: MCV2_BOND as `0x${string}`,
        abi: [priceForNextMintFunction],
        functionName: "priceForNextMint",
        args: [trade.token_address as `0x${string}`],
        blockNumber: BigInt(trade.block_number),
      });

      const marginalPrice = Number(formatUnits(price, 18));

      const { error: updateError } = await supabase
        .from("trade_history")
        .update({ price_per_token: marginalPrice })
        .eq("id", trade.id);

      if (updateError) {
        console.error(`  [FAIL] id=${trade.id}: ${updateError.message}`);
        failed++;
      } else {
        const oldPrice = trade.price_per_token;
        if (Math.abs(marginalPrice - oldPrice) > 0.0001) {
          console.log(`  [FIX] id=${trade.id} block=${trade.block_number}: ${oldPrice} → ${marginalPrice}`);
        }
        updated++;
      }
    } catch (err) {
      console.error(`  [FAIL] id=${trade.id} block=${trade.block_number}: ${(err as Error).message?.slice(0, 80)}`);
      failed++;
    }

    // Delay between RPC calls to avoid rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("");
  console.log(`=== Backfill complete: ${updated} updated, ${failed} failed ===`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
