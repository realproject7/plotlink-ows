import { NextResponse } from "next/server";
import { decodeEventLog } from "viem";
import { publicClient } from "../../../../lib/rpc";
import { createServerClient } from "../../../../lib/supabase";
import { mcv2BondEventAbi } from "../../../../lib/contracts/abi";
import { MCV2_BOND, ZAP_PLOTLINK } from "../../../../lib/contracts/constants";

/** Fail closed in production when CRON_SECRET is unset */
function verifyCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!verifyCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // Fetch trade_history rows missing user_address OR attributed to the Zap contract
  const { data: rows, error: fetchError } = await supabase
    .from("trade_history")
    .select("id, tx_hash, log_index")
    .or(`user_address.is.null,user_address.eq.${ZAP_PLOTLINK.toLowerCase()}`)
    .order("id", { ascending: true })
    .limit(500);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ message: "No rows to backfill", updated: 0 });
  }

  let updated = 0;
  let errors = 0;
  const errorDetails: { id: number; tx_hash: string; reason: string }[] = [];

  // Group by tx_hash to minimize RPC calls
  const byTx = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byTx.get(row.tx_hash) ?? [];
    existing.push(row);
    byTx.set(row.tx_hash, existing);
  }

  for (const [txHash, txRows] of byTx) {
    try {
      const receipt = await publicClient.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      for (const row of txRows) {
        const log = receipt.logs.find(
          (l) =>
            l.logIndex === row.log_index &&
            l.address.toLowerCase() === MCV2_BOND.toLowerCase(),
        );

        if (!log) {
          errorDetails.push({ id: row.id, tx_hash: txHash, reason: "Log not found in receipt" });
          errors++;
          continue;
        }

        try {
          const decoded = decodeEventLog({
            abi: mcv2BondEventAbi,
            data: log.data,
            topics: log.topics,
          });

          const args = decoded.args as { user: `0x${string}`; receiver: `0x${string}` };
          const userAddress = args.receiver.toLowerCase();

          // Delete intermediate Zap self-mints (receiver is the Zap contract)
          if (userAddress === ZAP_PLOTLINK.toLowerCase()) {
            const { error: deleteError } = await supabase
              .from("trade_history")
              .delete()
              .eq("id", row.id);
            if (deleteError) {
              errorDetails.push({ id: row.id, tx_hash: txHash, reason: deleteError.message });
              errors++;
            } else {
              updated++;
            }
            continue;
          }

          const { error: updateError } = await supabase
            .from("trade_history")
            .update({ user_address: userAddress })
            .eq("id", row.id);

          if (updateError) {
            errorDetails.push({ id: row.id, tx_hash: txHash, reason: updateError.message });
            errors++;
          } else {
            updated++;
          }
        } catch (decodeErr) {
          errorDetails.push({
            id: row.id,
            tx_hash: txHash,
            reason: decodeErr instanceof Error ? decodeErr.message : String(decodeErr),
          });
          errors++;
        }
      }
    } catch (rpcErr) {
      for (const row of txRows) {
        errorDetails.push({
          id: row.id,
          tx_hash: txHash,
          reason: `RPC error: ${rpcErr instanceof Error ? rpcErr.message : String(rpcErr)}`,
        });
        errors++;
      }
    }
  }

  return NextResponse.json({
    total: rows.length,
    updated,
    errors,
    ...(errorDetails.length > 0 ? { errorDetails } : {}),
  });
}
