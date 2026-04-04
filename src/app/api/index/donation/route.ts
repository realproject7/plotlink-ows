import { NextResponse } from "next/server";
import { type Hex, decodeEventLog, encodeEventTopics } from "viem";
import { publicClient, getReceiptWithRetry } from "../../../../../lib/rpc";
import { createServerClient } from "../../../../../lib/supabase";
import { validateRecentTx } from "../../../../../lib/index-auth";
import {
  storyFactoryAbi,
  donationEvent,
} from "../../../../../lib/contracts/abi";
import { STORY_FACTORY } from "../../../../../lib/contracts/constants";
import type { Database } from "../../../../../lib/supabase";

/** Donation event topic0 */
const DONATION_TOPIC = encodeEventTopics({
  abi: [donationEvent],
  eventName: "Donation",
})[0];

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const body = await req.json();
  const txHash = body.txHash as Hex | undefined;

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return error("Missing or invalid txHash");
  }

  // 1. Validate tx exists and is recent (< 5 min) — prevents spam
  const receipt = await validateRecentTx(txHash);
  if (!receipt) {
    return error("Transaction not found, failed, or too old");
  }

  // 2. Find Donation event log by event signature (topic0)
  const donationLog = receipt.logs.find(
    (log) => log.topics[0] === DONATION_TOPIC
  );

  if (!donationLog) {
    return error("Donation event not found in receipt");
  }

  // 3. Decode event
  let decoded;
  try {
    decoded = decodeEventLog({
      abi: storyFactoryAbi,
      data: donationLog.data,
      topics: donationLog.topics,
    });
  } catch {
    return error("Failed to decode Donation event");
  }

  if (decoded.eventName !== "Donation") {
    return error("Unexpected event type");
  }

  const { storylineId, donor, amount } = decoded.args;

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

  // 5. Upsert to Supabase
  const supabase = createServerClient();
  if (!supabase) {
    return error("Supabase not configured", 500);
  }

  const row: Database["public"]["Tables"]["donations"]["Insert"] = {
    storyline_id: Number(storylineId),
    donor_address: donor.toLowerCase(),
    amount: amount.toString(), // wei string to avoid precision loss
    block_timestamp: new Date(Number(blockTimestamp) * 1000).toISOString(),
    tx_hash: txHash.toLowerCase(),
    log_index: donationLog.logIndex!,
    contract_address: STORY_FACTORY.toLowerCase(),
  };

  const { error: dbError } = await supabase.from("donations").upsert(
    row,
    { onConflict: "tx_hash,log_index" }
  );

  if (dbError) {
    return error(`Database error: ${dbError.message}`, 500);
  }

  return NextResponse.json({ success: true });
}
