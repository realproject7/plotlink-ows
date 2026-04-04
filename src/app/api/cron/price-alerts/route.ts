import { NextResponse } from "next/server";
import { createServerClient, type Storyline } from "../../../../../lib/supabase";
import { getTokenPrice } from "../../../../../lib/price";
import { publicClient } from "../../../../../lib/rpc";
import { checkPriceChangeAlert } from "../../../../../lib/notifications.server";
import { STORY_FACTORY } from "../../../../../lib/contracts/constants";
import { type Address } from "viem";

/**
 * [#521] Cron: check token prices and send alerts for >10% changes.
 * Runs every ~5 minutes alongside the backfill cron.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // Get all active storylines with tokens
  const { data: storylines } = await supabase
    .from("storylines")
    .select("*")
    .eq("hidden", false)
    .eq("sunset", false)
    .neq("token_address", "")
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .returns<Storyline[]>();

  if (!storylines || storylines.length === 0) {
    return NextResponse.json({ checked: 0 });
  }

  let checked = 0;
  let alerts = 0;

  for (const sl of storylines) {
    try {
      const priceInfo = await getTokenPrice(sl.token_address as Address, publicClient);
      if (!priceInfo) continue;

      const price = parseFloat(priceInfo.pricePerToken);
      if (price <= 0) continue;

      const alerted = await checkPriceChangeAlert(
        sl.token_address,
        price,
        sl.storyline_id,
        sl.title,
      );
      checked++;
      if (alerted) alerts++;
    } catch {
      // Skip individual token errors
    }
  }

  return NextResponse.json({ checked, alerts });
}
