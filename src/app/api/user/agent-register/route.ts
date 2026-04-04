import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "../../../../../lib/supabase";

/**
 * POST /api/user/agent-register
 * Upserts agent columns on the user row after on-chain registration.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, agentId, name, description, genre, llmModel, agentWallet, agentOwner } = body;

    if (!walletAddress || typeof walletAddress !== "string" || !agentId) {
      return NextResponse.json({ error: "walletAddress and agentId are required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    }

    const normalized = walletAddress.toLowerCase();

    // Find existing user — prefer rows with agent_id, then standard address columns
    const { data: byAgentWallet } = await supabase
      .from("users")
      .select("id")
      .eq("agent_wallet", normalized)
      .not("agent_id", "is", null)
      .single();

    const { data: byAgentOwner } = !byAgentWallet
      ? await supabase.from("users").select("id").eq("agent_owner", normalized).not("agent_id", "is", null).single()
      : { data: byAgentWallet };

    // Fallback: standard address columns (any row, even without agent_id — we'll update it)
    let existingUser = byAgentWallet ?? byAgentOwner;
    if (!existingUser) {
      const { data: byVerified } = await supabase
        .from("users")
        .select("id")
        .contains("verified_addresses", [normalized])
        .single();

      const { data: byPrimary } = !byVerified
        ? await supabase.from("users").select("id").eq("primary_address", normalized).single()
        : { data: byVerified };

      existingUser = byVerified ?? byPrimary;
    }

    const agentFields = {
      agent_id: Number(agentId),
      agent_name: name || null,
      agent_description: description || null,
      agent_genre: genre || null,
      agent_llm_model: llmModel || null,
      agent_wallet: agentWallet?.toLowerCase() || null,
      agent_owner: (agentOwner || walletAddress).toLowerCase(),
      agent_registered_at: new Date().toISOString(),
    };

    if (existingUser) {
      const { error: updateError } = await supabase.from("users").update(agentFields).eq("id", existingUser.id);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    } else {
      const { error: insertError } = await supabase.from("users").insert({
        primary_address: normalized,
        ...agentFields,
      });

      // 23505: row was created concurrently — update it instead
      if (insertError?.code === "23505") {
        const { data: raceUser } = await supabase
          .from("users")
          .select("id")
          .or(`primary_address.eq.${normalized},agent_wallet.eq.${normalized},agent_owner.eq.${normalized}`)
          .limit(1)
          .single();

        if (raceUser) {
          const { error: updateError } = await supabase.from("users").update(agentFields).eq("id", raceUser.id);
          if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
          }
        } else {
          return NextResponse.json({ error: "Conflict but user not found on retry" }, { status: 500 });
        }
      } else if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
