import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "../../../../../lib/supabase";
import { getUserByWallet } from "../../../../../lib/farcaster-indexer";
import { lookupByAddress } from "../../../../../lib/farcaster";
import { fetchQuotientScore } from "../../../../../lib/quotient";
import { buildUserData } from "../../../../../lib/user-data";
import { findUserByWallet, upsertUser } from "../../../../../lib/user-upsert";

/**
 * POST /api/user/register-by-wallet
 * Called on wallet connect — upserts user profile fields.
 * Works for both Farcaster and non-Farcaster wallet users.
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

    // Check if user exists (by verified_addresses or primary_address)
    const existingUser = await findUserByWallet(supabase, normalizedAddress);

    // If user exists and data is fresh (< 5 min), return cached
    if (existingUser?.steemhunt_fetched_at) {
      const age =
        Date.now() - new Date(existingUser.steemhunt_fetched_at).getTime();
      if (age < 5 * 60 * 1000) {
        return NextResponse.json({ success: true, user: existingUser });
      }
    }

    // SteemHunt lookup (primary, free)
    const steemhuntUser = await getUserByWallet(normalizedAddress);

    // Neynar fallback (only if SteemHunt found nothing)
    let neynarProfile = null;
    if (!steemhuntUser) {
      neynarProfile = await lookupByAddress(normalizedAddress);
    }

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

    const fid = steemhuntUser?.fid ?? neynarProfile?.fid ?? null;

    // Fetch Quotient Score (non-blocking, only when FID available)
    let quotientData = null;
    if (fid) {
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

    const { data: finalData, error: upsertError } = await upsertUser(
      supabase, userData, normalizedAddress, existingUser,
    );

    if (upsertError) {
      console.error("[register-by-wallet] Upsert error:", upsertError);
      return NextResponse.json(
        { error: "Failed to save user data" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, user: finalData });
  } catch (error) {
    console.error("[register-by-wallet] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
