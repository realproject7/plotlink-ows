import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "../../../../../lib/supabase";

/**
 * POST /api/user/agent-update
 * Updates specific agent columns on the user row after management actions.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, fields } = body;

    if (!walletAddress || typeof walletAddress !== "string" || !fields || typeof fields !== "object") {
      return NextResponse.json({ error: "walletAddress and fields are required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    }

    const normalized = walletAddress.toLowerCase();

    // Allow only known agent columns
    const allowedKeys = [
      "agent_name", "agent_description", "agent_genre",
      "agent_llm_model", "agent_wallet", "agent_owner",
    ];
    const sanitized: Record<string, string | null> = {};
    for (const key of allowedKeys) {
      if (key in fields) {
        sanitized[key] = fields[key] != null ? String(fields[key]).toLowerCase() : null;
      }
    }
    // Name/description/genre/model should preserve case
    for (const key of ["agent_name", "agent_description", "agent_genre", "agent_llm_model"]) {
      if (key in fields) {
        sanitized[key] = fields[key] || null;
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // Find user row with agent_id, prioritizing agent-specific columns
    const { data: byAgentWallet } = await supabase
      .from("users")
      .select("id")
      .eq("agent_wallet", normalized)
      .not("agent_id", "is", null)
      .single();

    const { data: byAgentOwner } = !byAgentWallet
      ? await supabase.from("users").select("id").eq("agent_owner", normalized).not("agent_id", "is", null).single()
      : { data: byAgentWallet };

    const { data: byVerified } = !(byAgentWallet ?? byAgentOwner)
      ? await supabase.from("users").select("id").contains("verified_addresses", [normalized]).not("agent_id", "is", null).single()
      : { data: null };

    const { data: byPrimary } = !(byAgentWallet ?? byAgentOwner ?? byVerified)
      ? await supabase.from("users").select("id").eq("primary_address", normalized).not("agent_id", "is", null).single()
      : { data: null };

    // Fallback: any matching row (even without agent_id)
    let existingUser = byAgentWallet ?? byAgentOwner ?? byVerified ?? byPrimary;
    if (!existingUser) {
      const { data: anyMatch } = await supabase
        .from("users")
        .select("id")
        .or(`primary_address.eq.${normalized},agent_wallet.eq.${normalized},agent_owner.eq.${normalized}`)
        .single();
      existingUser = anyMatch;
    }
    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { error: updateError } = await supabase.from("users").update(sanitized).eq("id", existingUser.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
