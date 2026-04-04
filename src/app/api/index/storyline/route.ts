import { NextResponse } from "next/server";
import { type Hex, decodeEventLog, encodeEventTopics } from "viem";
import { publicClient, getReceiptWithRetry } from "../../../../../lib/rpc";
import { createServerClient } from "../../../../../lib/supabase";
import { validateRecentTx } from "../../../../../lib/index-auth";
import {
  storyFactoryAbi,
  storylineCreatedEvent,
} from "../../../../../lib/contracts/abi";
import { STORY_FACTORY } from "../../../../../lib/contracts/constants";
import { detectWriterType } from "../../../../../lib/contracts/erc8004";
import { hashContent } from "../../../../../lib/content";
import { GENRES, LANGUAGES } from "../../../../../lib/genres";
import type { Database } from "../../../../../lib/supabase";
import { reconcileStorylinePlotCount } from "../../../../../lib/reconcile";

const IPFS_GATEWAY = "https://ipfs.filebase.io/ipfs/";
const IPFS_TIMEOUT_MS = 10_000;

/** StorylineCreated event topic0 */
const STORYLINE_CREATED_TOPIC = encodeEventTopics({
  abi: [storylineCreatedEvent],
  eventName: "StorylineCreated",
})[0];

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const body = await req.json();
  const txHash = body.txHash as Hex | undefined;
  const fallbackContent = body.content as string | undefined;
  const rawGenre = body.genre as string | undefined;
  const rawLanguage = body.language as string | undefined;
  const genre = rawGenre && (GENRES as readonly string[]).includes(rawGenre) ? rawGenre : null;
  const language = rawLanguage && (LANGUAGES as readonly string[]).includes(rawLanguage) ? rawLanguage : "English";

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return error("Missing or invalid txHash");
  }

  // 1. Validate tx exists and is recent (< 5 min) — prevents spam
  const receipt = await validateRecentTx(txHash);
  if (!receipt) {
    return error("Transaction not found, failed, or too old");
  }

  // 2. Find StorylineCreated event log by event signature (topic0)
  const storylineLog = receipt.logs.find(
    (log) => log.topics[0] === STORYLINE_CREATED_TOPIC
  );

  if (!storylineLog) {
    return error("StorylineCreated event not found in receipt");
  }

  // 3. Decode event
  let decoded;
  try {
    decoded = decodeEventLog({
      abi: storyFactoryAbi,
      data: storylineLog.data,
      topics: storylineLog.topics,
    });
  } catch {
    return error("Failed to decode StorylineCreated event");
  }

  if (decoded.eventName !== "StorylineCreated") {
    return error("Unexpected event type");
  }

  const {
    storylineId,
    writer,
    tokenAddress,
    title,
    hasDeadline,
    openingCID,
    openingHash,
  } = decoded.args;

  // 4. Get block timestamp
  let blockTimestamp: bigint;
  try {
    const block = await publicClient.getBlock({
      blockNumber: receipt.blockNumber,
    });
    blockTimestamp = block.timestamp;
  } catch {
    return error("Failed to fetch block", 502);
  }

  // 5. Detect writer type via ERC-8004 (best-effort, defaults to human)
  const writerType = await detectWriterType(writer);

  // 6. Fetch genesis plot content from IPFS (with fallback)
  let genesisContent: string | null = null;
  try {
    const ipfsRes = await fetch(`${IPFS_GATEWAY}${openingCID}`, {
      signal: AbortSignal.timeout(IPFS_TIMEOUT_MS),
    });
    if (!ipfsRes.ok) throw new Error(`IPFS status ${ipfsRes.status}`);
    const ipfsContent = await ipfsRes.text();
    // Verify IPFS content hash matches on-chain hash
    if (hashContent(ipfsContent) === openingHash) {
      genesisContent = ipfsContent;
    }
    // If hash mismatches, fall through to fallback content below
  } catch {
    // IPFS fetch failed — fall through to fallback content below
  }

  // 7. Try fallback content if IPFS content was unavailable or hash-mismatched
  if (!genesisContent && fallbackContent) {
    if (hashContent(fallbackContent) === openingHash) {
      genesisContent = fallbackContent;
    }
  }

  if (!genesisContent) {
    return error("Genesis content hash mismatch (IPFS and fallback both failed)");
  }

  // 8. Upsert storyline to Supabase
  const supabase = createServerClient();
  if (!supabase) {
    return error("Supabase not configured", 500);
  }

  const timestampISO = new Date(Number(blockTimestamp) * 1000).toISOString();

  const storylineRow: Database["public"]["Tables"]["storylines"]["Insert"] = {
    storyline_id: Number(storylineId),
    writer_address: writer.toLowerCase(),
    token_address: tokenAddress.toLowerCase(),
    title,
    plot_count: 1, // genesis plot
    has_deadline: hasDeadline,
    writer_type: writerType,
    last_plot_time: timestampISO,
    block_timestamp: timestampISO,
    tx_hash: txHash.toLowerCase(),
    log_index: storylineLog.logIndex!,
    contract_address: STORY_FACTORY.toLowerCase(),
    genre,
    language,
  };

  const { error: dbError } = await supabase.from("storylines").upsert(
    storylineRow,
    { onConflict: "tx_hash,log_index" }
  );

  if (dbError) {
    return error(`Database error (storyline): ${dbError.message}`, 500);
  }

  // 9. Insert genesis plot (plot_index = 0) into plots table
  const plotRow: Database["public"]["Tables"]["plots"]["Insert"] = {
    storyline_id: Number(storylineId),
    plot_index: 0,
    writer_address: writer.toLowerCase(),
    content: genesisContent,
    content_cid: openingCID,
    content_hash: openingHash as string,
    block_timestamp: timestampISO,
    tx_hash: txHash.toLowerCase(),
    log_index: storylineLog.logIndex!,
    contract_address: STORY_FACTORY.toLowerCase(),
  };

  const { error: plotDbError } = await supabase.from("plots").upsert(
    plotRow,
    { onConflict: "storyline_id,plot_index", ignoreDuplicates: true }
  );

  if (plotDbError) {
    return error(`Database error (genesis plot): ${plotDbError.message}`, 500);
  }

  // Reconcile plot_count from actual plots rows (prevents genesis double-count)
  await reconcileStorylinePlotCount(supabase, Number(storylineId));

  return NextResponse.json({ success: true });
}
