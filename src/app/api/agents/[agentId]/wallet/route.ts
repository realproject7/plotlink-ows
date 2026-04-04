import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "../../../../../../lib/supabase";
import {
  createAgentWallet,
  getBaseAddress,
  createSpendingPolicy,
  createAgentApiKey,
  revokeAgentApiKey,
} from "../../../../../../lib/ows";
import { randomBytes } from "crypto";

type RouteParams = { params: Promise<{ agentId: string }> };

/** Look up the agent's user row and verify caller ownership. */
async function getAgentUser(agentId: string, callerAddress: string | null) {
  const supabase = createServiceRoleClient();
  if (!supabase) return { error: "Database not configured", status: 500 } as const;

  const { data: user, error } = await supabase
    .from("users")
    .select("id, agent_id, agent_owner, agent_wallet")
    .eq("agent_id", Number(agentId))
    .single();

  if (error || !user) return { error: "Agent not found", status: 404 } as const;
  if (!callerAddress || user.agent_owner !== callerAddress.toLowerCase()) {
    return { error: "Not the agent owner", status: 403 } as const;
  }

  return { user, supabase } as const;
}

/**
 * POST /api/agents/[agentId]/wallet
 * Creates an OWS wallet, policy, and API key for the agent.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { agentId } = await params;
    const body = await request.json();
    const callerAddress = body.callerAddress as string | null;

    const result = await getAgentUser(agentId, callerAddress);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { user, supabase } = result;

    // Check if wallet already exists
    const { data: existing } = await supabase
      .from("agent_wallets")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (existing) {
      return NextResponse.json({ error: "Agent already has an active wallet" }, { status: 409 });
    }

    // Create OWS wallet
    const walletName = `plotlink-agent-${agentId}`;
    const passphrase = randomBytes(32).toString("hex");
    const wallet = createAgentWallet(walletName, passphrase);
    const baseAddress = getBaseAddress(wallet);

    if (!baseAddress) {
      return NextResponse.json({ error: "Failed to derive EVM address" }, { status: 500 });
    }

    // Create spending policy
    const policyName = `plotlink-${agentId}-policy`;
    const spendCap = process.env.OWS_DEFAULT_POLICY_SPEND_CAP || "10";
    createSpendingPolicy({
      name: policyName,
      maxSpend: spendCap,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Create scoped API key
    const apiKey = createAgentApiKey(
      `plotlink-agent-${agentId}-key`,
      [wallet.id],
      [policyName],
      passphrase,
    );

    // Store in database (API key token stored server-side only)
    const { error: insertError } = await supabase.from("agent_wallets").insert({
      user_id: user.id,
      wallet_id: wallet.id,
      wallet_name: walletName,
      address_base: baseAddress,
      api_key_id: apiKey.id,
      policy_ids: [policyName],
      spend_cap_usdc: Number(spendCap),
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Store passphrase + API key token in a separate server-only location
    // For now, store encrypted in env or vault — the token is in apiKey.token
    // This is intentionally NOT returned to the client
    await supabase.from("agent_wallets").update({
      api_key_id: apiKey.id,
    }).eq("wallet_id", wallet.id);

    return NextResponse.json({
      address: baseAddress,
      walletId: wallet.id,
      spendCap: Number(spendCap),
    });
  } catch (err) {
    console.error("Wallet creation failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/agents/[agentId]/wallet
 * Returns wallet metadata for the agent.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { agentId } = await params;
    const callerAddress = request.nextUrl.searchParams.get("callerAddress");

    const result = await getAgentUser(agentId, callerAddress);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { user, supabase } = result;

    const { data: wallet, error } = await supabase
      .from("agent_wallets")
      .select("wallet_id, wallet_name, address_base, spend_cap_usdc, policy_ids, is_active, created_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (error || !wallet) {
      return NextResponse.json({ error: "No active wallet found" }, { status: 404 });
    }

    return NextResponse.json(wallet);
  } catch (err) {
    console.error("Wallet info failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/agents/[agentId]/wallet
 * Updates wallet spend cap.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { agentId } = await params;
    const body = await request.json();
    const { callerAddress, spendCap } = body;

    if (typeof spendCap !== "number" || spendCap < 0) {
      return NextResponse.json({ error: "Invalid spendCap" }, { status: 400 });
    }

    const result = await getAgentUser(agentId, callerAddress);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { user, supabase } = result;

    const { error } = await supabase
      .from("agent_wallets")
      .update({ spend_cap_usdc: spendCap })
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, spendCap });
  } catch (err) {
    console.error("Wallet update failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/agents/[agentId]/wallet
 * Deactivates wallet and revokes API key.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { agentId } = await params;
    const callerAddress = request.nextUrl.searchParams.get("callerAddress");

    const result = await getAgentUser(agentId, callerAddress);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { user, supabase } = result;

    const { data: wallet } = await supabase
      .from("agent_wallets")
      .select("wallet_id, api_key_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (!wallet) {
      return NextResponse.json({ error: "No active wallet found" }, { status: 404 });
    }

    // Revoke API key
    if (wallet.api_key_id) {
      try {
        revokeAgentApiKey(wallet.api_key_id);
      } catch {
        // Key may already be revoked
      }
    }

    // Soft-delete: mark inactive
    await supabase
      .from("agent_wallets")
      .update({ is_active: false })
      .eq("user_id", user.id)
      .eq("wallet_id", wallet.wallet_id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Wallet deactivation failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
