import { NextResponse } from "next/server";
import { decodeEventLog, type Log } from "viem";
import { publicClient } from "../../../../../lib/rpc";
import { createServerClient } from "../../../../../lib/supabase";
import { storyFactoryAbi } from "../../../../../lib/contracts/abi";
import { STORY_FACTORY, DEPLOYMENT_BLOCK } from "../../../../../lib/contracts/constants";
import { hashContent } from "../../../../../lib/content";
import { detectWriterType } from "../../../../../lib/contracts/erc8004";
import { reconcileStorylinePlotCount } from "../../../../../lib/reconcile";
import { notifyNewPlot, notifyNewStoryline } from "../../../../../lib/notifications.server";
import type { Database } from "../../../../../lib/supabase";

const IPFS_GATEWAY = "https://ipfs.filebase.io/ipfs/";
const IPFS_TIMEOUT_MS = 10_000;

/**
 * How many blocks to scan per cron run (~5 min on Base = ~150 blocks at 2s/block).
 * Slightly over-scan to handle timing variance.
 */
const SCAN_BLOCKS = BigInt(200);

/** Cron authorization — fail closed in production when CRON_SECRET is unset */
function verifyCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

async function fetchIPFSContent(cid: string): Promise<string | null> {
  try {
    const res = await fetch(`${IPFS_GATEWAY}${cid}`, {
      signal: AbortSignal.timeout(IPFS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function getBlockTimestamp(blockNumber: bigint): Promise<string> {
  const block = await publicClient.getBlock({ blockNumber });
  return new Date(Number(block.timestamp) * 1000).toISOString();
}

type PlotInsert = Database["public"]["Tables"]["plots"]["Insert"];
type StorylineInsert = Database["public"]["Tables"]["storylines"]["Insert"];
type DonationInsert = Database["public"]["Tables"]["donations"]["Insert"];

type BackfillSupabaseClient = NonNullable<ReturnType<typeof createServerClient>>;

async function logBackfillFailure(
  supabase: BackfillSupabaseClient,
  opts: {
    txHash: string;
    logIndex: number;
    blockNumber: number;
    eventName: string;
    storylineId: number;
    reason: string;
  }
) {
  const { error } = await supabase.from("backfill_failures").insert({
    tx_hash: opts.txHash,
    log_index: opts.logIndex,
    block_number: opts.blockNumber,
    event_name: opts.eventName,
    storyline_id: opts.storylineId,
    reason: opts.reason,
  });
  if (error) {
    throw new Error(`Failed to log backfill failure: ${error.message}`);
  }
}

export async function GET(req: Request) {
  if (!verifyCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  // Skip if StoryFactory not yet deployed
  if (STORY_FACTORY === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json({
      skipped: true,
      reason: "StoryFactory not deployed yet",
    });
  }

  const currentBlock = await publicClient.getBlockNumber();

  // Read last processed block from persistent cursor
  const { data: cursor } = await supabase.from("backfill_cursor")
    .select("last_block")
    .eq("id", 1)
    .single();
  const lastBlock = cursor?.last_block ? BigInt(cursor.last_block) : BigInt(0);

  // Start from block after last processed; fall back to DEPLOYMENT_BLOCK for new contracts
  const fromBlock = lastBlock > BigInt(0) ? lastBlock + BigInt(1) : DEPLOYMENT_BLOCK;

  if (fromBlock > currentBlock) {
    return NextResponse.json({ skipped: true, reason: "Already up to date" });
  }

  // Cap scan range per run to avoid timeouts on large backlogs
  const toBlock = (fromBlock + SCAN_BLOCKS) < currentBlock
    ? fromBlock + SCAN_BLOCKS
    : currentBlock;

  // Fetch all StoryFactory logs in the scan range
  const logs = await publicClient.getLogs({
    address: STORY_FACTORY,
    fromBlock,
    toBlock,
  });

  let storylinesInserted = 0;
  let plotsInserted = 0;
  let donationsInserted = 0;
  let errors = 0;
  let failures = 0;

  // Cache block timestamps to avoid redundant RPC calls
  const blockTimestampCache = new Map<bigint, string>();
  async function getCachedBlockTimestamp(blockNumber: bigint): Promise<string> {
    const cached = blockTimestampCache.get(blockNumber);
    if (cached) return cached;
    const ts = await getBlockTimestamp(blockNumber);
    blockTimestampCache.set(blockNumber, ts);
    return ts;
  }

  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: storyFactoryAbi,
        data: log.data,
        topics: log.topics,
      });

      const txHash = log.transactionHash!.toLowerCase();
      const logIndex = log.logIndex!;

      if (decoded.eventName === "StorylineCreated") {
        const result = await processStorylineCreated(
          decoded,
          log,
          txHash,
          logIndex,
          supabase,
          getCachedBlockTimestamp
        );
        storylinesInserted++;
        if (result.genesisPlotFailed) failures++;
        else {
          // Notify users about the new storyline
          const args = decoded.args as { storylineId: bigint; title: string; writer: `0x${string}` };
          notifyNewStoryline(Number(args.storylineId), args.title, args.writer).catch(() => {});
        }
      } else if (decoded.eventName === "PlotChained") {
        const failed = await processPlotChained(
          decoded,
          log,
          txHash,
          logIndex,
          supabase,
          getCachedBlockTimestamp
        );
        if (failed) failures++;
        else {
          plotsInserted++;
          // Notify users about the new plot
          const args = decoded.args as { storylineId: bigint; plotIndex: bigint; title: string };
          const storyTitle = args.title || `Story #${Number(args.storylineId)}`;
          notifyNewPlot(Number(args.storylineId), storyTitle, Number(args.plotIndex)).catch(() => {});
        }
      } else if (decoded.eventName === "Donation") {
        await processDonation(
          decoded,
          log,
          txHash,
          logIndex,
          supabase,
          getCachedBlockTimestamp
        );
        donationsInserted++;
      }
    } catch (err) {
      const txHash = log.transactionHash ?? "unknown";
      const logIdx = log.logIndex ?? "?";
      console.error(`Backfill error at tx=${txHash} logIndex=${logIdx}:`, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  // Persist cursor — advance to highest block actually scanned
  const { error: cursorError } = await supabase.from("backfill_cursor")
    .update({ last_block: Number(toBlock), updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (cursorError) {
    console.error(`Failed to update backfill cursor: ${cursorError.message}`);
  }

  return NextResponse.json({
    scanned: { fromBlock: Number(fromBlock), toBlock: Number(toBlock) },
    processed: {
      storylines: storylinesInserted,
      plots: plotsInserted,
      donations: donationsInserted,
    },
    failures,
    errors,
  });
}

type DecodedEvent = ReturnType<typeof decodeEventLog<typeof storyFactoryAbi>>;

async function processStorylineCreated(
  decoded: DecodedEvent,
  log: Log,
  txHash: string,
  logIndex: number,
  supabase: BackfillSupabaseClient,
  getTimestamp: (blockNumber: bigint) => Promise<string>
): Promise<{ genesisPlotFailed: boolean }> {
  const {
    storylineId,
    writer,
    tokenAddress,
    title,
    hasDeadline,
    openingCID,
    openingHash,
  } = decoded.args as { storylineId: bigint; writer: `0x${string}`; tokenAddress: `0x${string}`; title: string; hasDeadline: boolean; openingCID: string; openingHash: `0x${string}` };

  const timestampISO = await getTimestamp(log.blockNumber!);
  const writerType = await detectWriterType(writer);

  const storylineRow: StorylineInsert = {
    storyline_id: Number(storylineId),
    writer_address: writer.toLowerCase(),
    token_address: tokenAddress.toLowerCase(),
    title,
    plot_count: 1,
    has_deadline: hasDeadline,
    writer_type: writerType,
    last_plot_time: timestampISO,
    block_timestamp: timestampISO,
    tx_hash: txHash,
    log_index: logIndex,
    contract_address: STORY_FACTORY.toLowerCase(),
  };

  const { error: storylineError } = await supabase
    .from("storylines")
    .upsert(storylineRow, { onConflict: "tx_hash,log_index" });
  if (storylineError) {
    throw new Error(`Database error (storyline): ${storylineError.message}`);
  }

  // Insert genesis plot
  const content = await fetchIPFSContent(openingCID);
  if (content === null) {
    await logBackfillFailure(supabase, {
      txHash, logIndex, blockNumber: Number(log.blockNumber!),
      eventName: "StorylineCreated", storylineId: Number(storylineId),
      reason: "IPFS fetch failed for genesis plot",
    });
    return { genesisPlotFailed: true };
  }
  if (hashContent(content) !== openingHash) {
    await logBackfillFailure(supabase, {
      txHash, logIndex, blockNumber: Number(log.blockNumber!),
      eventName: "StorylineCreated", storylineId: Number(storylineId),
      reason: "Content hash mismatch for genesis plot",
    });
    return { genesisPlotFailed: true };
  }

  const plotRow: PlotInsert = {
    storyline_id: Number(storylineId),
    plot_index: 0,
    writer_address: writer.toLowerCase(),
    content,
    content_cid: openingCID,
    content_hash: openingHash as string,
    block_timestamp: timestampISO,
    tx_hash: txHash,
    log_index: logIndex,
    contract_address: STORY_FACTORY.toLowerCase(),
  };
  const { error: plotError } = await supabase
    .from("plots")
    .upsert(plotRow, { onConflict: "storyline_id,plot_index", ignoreDuplicates: true });
  if (plotError) {
    throw new Error(`Database error (genesis plot): ${plotError.message}`);
  }

  // Reconcile plot_count from actual plots rows (prevents genesis double-count)
  await reconcileStorylinePlotCount(supabase, Number(storylineId));

  return { genesisPlotFailed: false };
}

async function processPlotChained(
  decoded: DecodedEvent,
  log: Log,
  txHash: string,
  logIndex: number,
  supabase: BackfillSupabaseClient,
  getTimestamp: (blockNumber: bigint) => Promise<string>
): Promise<boolean> {
  const { storylineId, plotIndex, writer, title, contentCID, contentHash } =
    decoded.args as { storylineId: bigint; plotIndex: bigint; writer: `0x${string}`; title: string; contentCID: string; contentHash: `0x${string}` };

  const content = await fetchIPFSContent(contentCID);
  if (content === null) {
    await logBackfillFailure(supabase, {
      txHash, logIndex, blockNumber: Number(log.blockNumber!),
      eventName: "PlotChained", storylineId: Number(storylineId),
      reason: "IPFS fetch failed",
    });
    return true;
  }
  if (hashContent(content) !== contentHash) {
    await logBackfillFailure(supabase, {
      txHash, logIndex, blockNumber: Number(log.blockNumber!),
      eventName: "PlotChained", storylineId: Number(storylineId),
      reason: "Content hash mismatch",
    });
    return true;
  }

  const timestampISO = await getTimestamp(log.blockNumber!);

  const row: PlotInsert = {
    storyline_id: Number(storylineId),
    plot_index: Number(plotIndex),
    writer_address: writer.toLowerCase(),
    title: title || "",
    content,
    content_cid: contentCID,
    content_hash: contentHash as string,
    block_timestamp: timestampISO,
    tx_hash: txHash,
    log_index: logIndex,
    contract_address: STORY_FACTORY.toLowerCase(),
  };

  const { error: plotError } = await supabase
    .from("plots")
    .upsert(row, { onConflict: "storyline_id,plot_index" });
  if (plotError) {
    throw new Error(`Database error (plot): ${plotError.message}`);
  }

  // Reconcile parent storyline plot_count and last_plot_time (idempotent)
  await reconcileStorylinePlotCount(supabase, Number(storylineId));
  return false;
}

async function processDonation(
  decoded: DecodedEvent,
  log: Log,
  txHash: string,
  logIndex: number,
  supabase: BackfillSupabaseClient,
  getTimestamp: (blockNumber: bigint) => Promise<string>
) {
  const { storylineId, donor, amount } = decoded.args as { storylineId: bigint; donor: `0x${string}`; amount: bigint };
  const timestampISO = await getTimestamp(log.blockNumber!);

  const row: DonationInsert = {
    storyline_id: Number(storylineId),
    donor_address: donor.toLowerCase(),
    amount: amount.toString(),
    block_timestamp: timestampISO,
    tx_hash: txHash,
    log_index: logIndex,
    contract_address: STORY_FACTORY.toLowerCase(),
  };

  const { error: donationError } = await supabase
    .from("donations")
    .upsert(row, { onConflict: "tx_hash,log_index" });
  if (donationError) {
    throw new Error(`Database error (donation): ${donationError.message}`);
  }
}
