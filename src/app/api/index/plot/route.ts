import { NextResponse } from "next/server";
import { type Hex, decodeEventLog, encodeEventTopics } from "viem";
import { publicClient, getReceiptWithRetry } from "../../../../../lib/rpc";
import { createServerClient } from "../../../../../lib/supabase";
import { validateRecentTx } from "../../../../../lib/index-auth";
import {
  storyFactoryAbi,
  plotChainedEvent,
} from "../../../../../lib/contracts/abi";
import { STORY_FACTORY } from "../../../../../lib/contracts/constants";
import { hashContent } from "../../../../../lib/content";
import { reconcileStorylinePlotCount } from "../../../../../lib/reconcile";
import type { Database } from "../../../../../lib/supabase";

const IPFS_GATEWAY = "https://ipfs.filebase.io/ipfs/";
const IPFS_TIMEOUT_MS = 10_000;

/** PlotChained event topic0 (keccak256 of the event signature) */
const PLOT_CHAINED_TOPIC = encodeEventTopics({
  abi: [plotChainedEvent],
  eventName: "PlotChained",
})[0];

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const body = await req.json();
  const txHash = body.txHash as Hex | undefined;
  const fallbackContent = body.content as string | undefined;

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return error("Missing or invalid txHash");
  }

  // 1. Validate tx exists and is recent (< 5 min) — prevents spam
  const receipt = await validateRecentTx(txHash);
  if (!receipt) {
    return error("Transaction not found, failed, or too old");
  }

  // 2. Find PlotChained event log by event signature (topic0)
  const plotChainedLog = receipt.logs.find(
    (log) => log.topics[0] === PLOT_CHAINED_TOPIC
  );

  if (!plotChainedLog) {
    return error("PlotChained event not found in receipt");
  }

  // 3. Decode event
  let decoded;
  try {
    decoded = decodeEventLog({
      abi: storyFactoryAbi,
      data: plotChainedLog.data,
      topics: plotChainedLog.topics,
    });
  } catch {
    return error("Failed to decode PlotChained event");
  }

  if (decoded.eventName !== "PlotChained") {
    return error("Unexpected event type");
  }

  const { storylineId, plotIndex, writer, title, contentCID, contentHash } =
    decoded.args;

  // 4. Fetch content from IPFS (with fallback)
  let content: string | null = null;
  try {
    const ipfsRes = await fetch(`${IPFS_GATEWAY}${contentCID}`, {
      signal: AbortSignal.timeout(IPFS_TIMEOUT_MS),
    });
    if (!ipfsRes.ok) throw new Error(`IPFS status ${ipfsRes.status}`);
    const ipfsContent = await ipfsRes.text();
    // Verify IPFS content hash matches on-chain hash
    if (hashContent(ipfsContent) === contentHash) {
      content = ipfsContent;
    }
    // If hash mismatches, fall through to fallback content below
  } catch {
    // IPFS fetch failed — fall through to fallback content below
  }

  // 5. Try fallback content if IPFS content was unavailable or hash-mismatched
  if (!content && fallbackContent) {
    if (hashContent(fallbackContent) === contentHash) {
      content = fallbackContent;
    }
  }

  if (!content) {
    return error("Content hash mismatch (IPFS and fallback both failed)");
  }

  // 6. Get block timestamp
  let blockTimestamp: bigint;
  try {
    const block = await publicClient.getBlock({
      blockNumber: receipt.blockNumber,
    });
    blockTimestamp = block.timestamp;
  } catch {
    return error("Failed to fetch block", 502);
  }

  // 7. Upsert to Supabase
  const supabase = createServerClient();
  if (!supabase) {
    return error("Supabase not configured", 500);
  }

  // 7a. Check deadline — reject if storyline's 7-day deadline has expired
  const DEADLINE_MS = 168 * 60 * 60 * 1000; // 7 days — matches DEADLINE_HOURS in DeadlineCountdown
  const { data: storylineRow } = await supabase
    .from("storylines")
    .select("last_plot_time, sunset, has_deadline")
    .eq("storyline_id", Number(storylineId))
    .single();

  if (storylineRow) {
    if (storylineRow.sunset) {
      return error("Storyline has sunset — no new plots allowed", 400);
    }
    if (storylineRow.has_deadline && storylineRow.last_plot_time) {
      const deadline = new Date(storylineRow.last_plot_time).getTime() + DEADLINE_MS;
      // Use block timestamp (when tx was mined) instead of Date.now() to avoid
      // rejecting plots that the contract already accepted near the deadline edge
      const blockTimeMs = Number(blockTimestamp) * 1000;
      if (blockTimeMs > deadline) {
        return error("Storyline deadline expired — no new plots allowed", 400);
      }
    }
  }

  const row: Database["public"]["Tables"]["plots"]["Insert"] = {
    storyline_id: Number(storylineId),
    plot_index: Number(plotIndex),
    writer_address: writer.toLowerCase(),
    title: title || "",
    content,
    content_cid: contentCID,
    content_hash: contentHash as string,
    block_timestamp: new Date(Number(blockTimestamp) * 1000).toISOString(),
    tx_hash: txHash.toLowerCase(),
    log_index: plotChainedLog.logIndex!,
    contract_address: STORY_FACTORY.toLowerCase(),
  };

  const { error: dbError } = await supabase.from("plots").upsert(
    row,
    { onConflict: "storyline_id,plot_index" }
  );

  if (dbError) {
    return error(`Database error: ${dbError.message}`, 500);
  }

  // Reconcile parent storyline plot_count and last_plot_time (idempotent)
  try {
    await reconcileStorylinePlotCount(supabase, Number(storylineId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown reconciliation error";
    console.error(`[index/plot] Reconciliation failed for storyline ${storylineId}: ${msg}`);
    return error(`Reconciliation failed: ${msg}`, 500);
  }

  return NextResponse.json({ success: true });
}
