import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "../../../../../lib/supabase";
import { getUserByWallet } from "../../../../../lib/farcaster-indexer";
import { lookupByAddress } from "../../../../../lib/farcaster";
import { fetchQuotientScore, isQuotientStale } from "../../../../../lib/quotient";
import { buildUserData } from "../../../../../lib/user-data";
import { getAgentMetadata, getAgentMetadataById, erc8004Abi } from "../../../../../lib/contracts/erc8004";
import { ERC8004_REGISTRY } from "../../../../../lib/contracts/constants";
import { publicClient } from "../../../../../lib/rpc";
import { findUserByWallet, upsertUser } from "../../../../../lib/user-upsert";
import type { Address } from "viem";

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * POST /api/user/onboard
 * Manual profile refresh. Enforces 5-min cooldown on ALL refreshes.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress } = body;

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json(
        { error: "Wallet address is required" },
        { status: 400 },
      );
    }

    const normalizedAddress = walletAddress.toLowerCase();
    const supabase = createServiceRoleClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 },
      );
    }

    // Check existing user (by verified_addresses or primary_address)
    const existingUser = await findUserByWallet(supabase, normalizedAddress);

    // Enforce 5-min cooldown on ALL refreshes
    if (existingUser?.steemhunt_fetched_at) {
      const age =
        Date.now() -
        new Date(existingUser.steemhunt_fetched_at).getTime();
      if (age < COOLDOWN_MS) {
        const remainingMs = COOLDOWN_MS - age;
        return NextResponse.json(
          {
            error: "Profile refresh on cooldown",
            cooldownRemainingMs: remainingMs,
            cooldownRemainingSeconds: Math.ceil(remainingMs / 1000),
          },
          { status: 429 },
        );
      }
    }

    // Fetch fresh data from SteemHunt
    const steemhuntUser = await getUserByWallet(normalizedAddress);
    let neynarProfile = null;
    if (!steemhuntUser) {
      neynarProfile = await lookupByAddress(normalizedAddress);
    }

    const fid = steemhuntUser?.fid ?? neynarProfile?.fid ?? null;

    // Build verified addresses
    let verifiedAddresses: string[];
    if (steemhuntUser) {
      verifiedAddresses = (steemhuntUser.addresses || []).map(
        (a: string) => a.toLowerCase(),
      );
    } else {
      verifiedAddresses = [normalizedAddress];
    }
    if (!verifiedAddresses.includes(normalizedAddress)) {
      verifiedAddresses.push(normalizedAddress);
    }

    // Refresh Quotient Score if stale
    let quotientData = null;
    if (
      fid &&
      isQuotientStale(existingUser?.quotient_updated_at ?? null)
    ) {
      try {
        quotientData = await fetchQuotientScore(fid);
      } catch {
        // Non-fatal
      }
    }

    const userData = await buildUserData({
      steemhuntUser,
      neynarProfile,
      verifiedAddresses,
      quotientData,
    });

    // Check ERC-8004 agent status if not already cached
    if (!existingUser?.agent_id) {
      try {
        // Check 1: is this wallet a bound agent wallet?
        let agentMeta = await getAgentMetadata(normalizedAddress as Address);

        // Check 2: does this wallet own an agent NFT? (owner with separate bound wallet)
        if (!agentMeta) {
          const balance = await publicClient.readContract({
            address: ERC8004_REGISTRY,
            abi: erc8004Abi,
            functionName: "balanceOf",
            args: [normalizedAddress as Address],
          }).catch(() => BigInt(0));

          if (balance > BigInt(0)) {
            const ownedTokenId = await publicClient.readContract({
              address: ERC8004_REGISTRY,
              abi: erc8004Abi,
              functionName: "tokenOfOwnerByIndex",
              args: [normalizedAddress as Address, BigInt(0)],
            }).catch(() => undefined);

            if (ownedTokenId !== undefined) {
              agentMeta = await getAgentMetadataById(ownedTokenId);
            }
          }
        }

        if (agentMeta?.agentId) {
          Object.assign(userData, {
            agent_id: Number(agentMeta.agentId),
            agent_name: agentMeta.name || null,
            agent_description: agentMeta.description || null,
            agent_genre: agentMeta.genre || null,
            agent_llm_model: agentMeta.llmModel || null,
            agent_owner: agentMeta.owner?.toLowerCase() || null,
            agent_wallet: agentMeta.agentWallet && agentMeta.agentWallet !== "0x0000000000000000000000000000000000000000"
              ? agentMeta.agentWallet.toLowerCase() : null,
            agent_registered_at: agentMeta.registeredAt || null,
          });
        }
      } catch {
        // Non-fatal — agent check is best-effort
      }
    }

    const { data: finalData, error: upsertError } = await upsertUser(
      supabase, userData, normalizedAddress, existingUser,
    );

    if (upsertError) {
      console.error("[onboard] Upsert error:", upsertError);
      return NextResponse.json(
        { error: "Failed to save user data" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, user: finalData });
  } catch (error) {
    console.error("[onboard] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
