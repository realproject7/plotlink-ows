import { NextResponse } from "next/server";
import { decodeEventLog, formatUnits, type Log } from "viem";
import { publicClient } from "../../../../../lib/rpc";
import { createServerClient } from "../../../../../lib/supabase";
import { mcv2BondEventAbi } from "../../../../../lib/contracts/abi";
import { MCV2_BOND, ZAP_PLOTLINK } from "../../../../../lib/contracts/constants";
import { erc20Abi } from "../../../../../lib/price";
import { getReserveUsdRate } from "../../../../../lib/reserve-usd-rate";
import type { Database } from "../../../../../lib/supabase";

const SCAN_BLOCKS = BigInt(200);
const CURSOR_ID = 2; // separate cursor row from backfill (id=1)

type TradeInsert = Database["public"]["Tables"]["trade_history"]["Insert"];
type SupabaseClient = NonNullable<ReturnType<typeof createServerClient>>;

/** Fail closed in production when CRON_SECRET is unset */
function verifyCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!verifyCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const currentBlock = await publicClient.getBlockNumber();

  // Read cursor
  const { data: cursor } = await supabase
    .from("backfill_cursor")
    .select("last_block")
    .eq("id", CURSOR_ID)
    .single();

  // If no cursor row exists, create one
  if (!cursor) {
    await supabase.from("backfill_cursor").insert({ id: CURSOR_ID, last_block: 0 });
  }

  const lastBlock = cursor?.last_block ? BigInt(cursor.last_block) : BigInt(0);
  const fromBlock = lastBlock > BigInt(0) ? lastBlock + BigInt(1) : BigInt(0);

  if (fromBlock > currentBlock) {
    return NextResponse.json({ skipped: true, reason: "Already up to date" });
  }

  const toBlock =
    fromBlock + SCAN_BLOCKS < currentBlock ? fromBlock + SCAN_BLOCKS : currentBlock;

  // Load known storyline token addresses
  const { data: storylines } = await supabase
    .from("storylines")
    .select("storyline_id, token_address")
    .not("token_address", "is", null);

  const tokenToStoryline = new Map<string, number>();
  for (const s of storylines ?? []) {
    if (s.token_address) {
      tokenToStoryline.set(s.token_address.toLowerCase(), s.storyline_id);
    }
  }

  if (tokenToStoryline.size === 0) {
    // Advance cursor even if no tokens to track
    await supabase
      .from("backfill_cursor")
      .update({ last_block: Number(toBlock), updated_at: new Date().toISOString() })
      .eq("id", CURSOR_ID);
    return NextResponse.json({ skipped: true, reason: "No storyline tokens to track" });
  }

  // Fetch all MCV2_Bond logs in range
  const logs = await publicClient.getLogs({
    address: MCV2_BOND,
    fromBlock,
    toBlock,
  });

  // Fetch current PLOT/USD rate once per batch.
  // If the oldest block in this batch (fromBlock) is far behind head, the current
  // rate may not reflect trade-time pricing. Use fromBlock for a conservative check
  // so the entire batch is labeled consistently — only near-head batches get 'live'.
  const reserveUsdRate = await getReserveUsdRate();
  const isCatchUp = currentBlock - fromBlock > BigInt(200);
  const rateSource = reserveUsdRate !== null
    ? (isCatchUp ? "backfill_approx" : "live")
    : null;

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  const blockTimestampCache = new Map<bigint, string>();
  async function getTimestamp(blockNumber: bigint): Promise<string> {
    const cached = blockTimestampCache.get(blockNumber);
    if (cached) return cached;
    const block = await publicClient.getBlock({ blockNumber });
    const ts = new Date(Number(block.timestamp) * 1000).toISOString();
    blockTimestampCache.set(blockNumber, ts);
    return ts;
  }

  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: mcv2BondEventAbi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "Mint" && decoded.eventName !== "Burn") {
        skipped++;
        continue;
      }

      const tokenAddress = (
        decoded.args as { token: `0x${string}` }
      ).token.toLowerCase();
      const storylineId = tokenToStoryline.get(tokenAddress);
      if (storylineId === undefined) {
        skipped++;
        continue;
      }

      await processTradeEvent(
        decoded,
        log,
        tokenAddress,
        storylineId,
        supabase,
        getTimestamp,
        reserveUsdRate,
        rateSource,
      );
      inserted++;
    } catch (err) {
      // Skip events that don't decode as Mint/Burn
      if (err instanceof Error && err.message.includes("could not find")) {
        skipped++;
        continue;
      }
      console.error(
        `Trade indexer error at tx=${log.transactionHash} logIndex=${log.logIndex}:`,
        err instanceof Error ? err.message : err,
      );
      errors++;
    }
  }

  // Advance cursor
  await supabase
    .from("backfill_cursor")
    .update({ last_block: Number(toBlock), updated_at: new Date().toISOString() })
    .eq("id", CURSOR_ID);

  return NextResponse.json({
    scanned: { fromBlock: Number(fromBlock), toBlock: Number(toBlock) },
    trades: inserted,
    skipped,
    errors,
  });
}

type DecodedEvent = ReturnType<typeof decodeEventLog<typeof mcv2BondEventAbi>>;

async function processTradeEvent(
  decoded: DecodedEvent,
  log: Log,
  tokenAddress: string,
  storylineId: number,
  supabase: SupabaseClient,
  getTimestamp: (blockNumber: bigint) => Promise<string>,
  reserveUsdRate: number | null,
  rateSource: string | null,
) {
  const args = decoded.args as {
    token: `0x${string}`;
    user: `0x${string}`;
    receiver: `0x${string}`;
    amountMinted?: bigint;
    amountBurned?: bigint;
    reserveAmount?: bigint;
    refundAmount?: bigint;
  };

  // Skip intermediate Zap self-mints (HUNT→PLOT conversion where receiver is the Zap contract)
  if (args.receiver.toLowerCase() === ZAP_PLOTLINK.toLowerCase()) return;

  const isMint = decoded.eventName === "Mint";
  const reserveAmount = isMint ? args.reserveAmount! : args.refundAmount!;
  const tokenAmount = isMint ? args.amountMinted! : args.amountBurned!;

  // Compute price per token (reserve per token, 18 decimals)
  const pricePerToken =
    tokenAmount > BigInt(0)
      ? Number(formatUnits(reserveAmount, 18)) / Number(formatUnits(tokenAmount, 18))
      : 0;

  // Read total supply at this block
  let totalSupply = BigInt(0);
  try {
    totalSupply = await publicClient.readContract({
      address: args.token,
      abi: erc20Abi,
      functionName: "totalSupply",
      blockNumber: log.blockNumber!,
    });
  } catch {
    // Fall back to 0 if historical read fails
  }

  const timestampISO = await getTimestamp(log.blockNumber!);

  const row: TradeInsert = {
    token_address: tokenAddress,
    storyline_id: storylineId,
    event_type: isMint ? "mint" : "burn",
    price_per_token: pricePerToken,
    total_supply: Number(formatUnits(totalSupply, 18)),
    reserve_amount: Number(formatUnits(reserveAmount, 18)),
    block_number: Number(log.blockNumber!),
    block_timestamp: timestampISO,
    tx_hash: log.transactionHash!.toLowerCase(),
    log_index: log.logIndex!,
    contract_address: MCV2_BOND.toLowerCase(),
    user_address: args.receiver.toLowerCase(),
    reserve_usd_rate: reserveUsdRate,
    rate_source: rateSource,
  };

  const { error } = await supabase
    .from("trade_history")
    .upsert(row, { onConflict: "tx_hash,log_index" });
  if (error) {
    throw new Error(`Database error (trade): ${error.message}`);
  }
}
