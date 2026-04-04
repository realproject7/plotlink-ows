import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "../../../../../lib/supabase";
import { fetchXStats } from "../../../../../lib/x-stats";

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * POST /api/user/x-stats
 * Fetch X/Twitter stats for a user. Requires twitter handle in DB.
 * Body: { walletAddress: string }
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

    // Look up user
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .contains("verified_addresses", [normalizedAddress])
      .single();

    if (!user) {
      return NextResponse.json(
        { error: "User not found. Connect wallet first." },
        { status: 404 },
      );
    }

    if (!user.twitter) {
      return NextResponse.json(
        { error: "No X/Twitter handle linked to this account." },
        { status: 404 },
      );
    }

    // Check cooldown
    if (user.x_stats_fetched_at) {
      const age =
        Date.now() - new Date(user.x_stats_fetched_at).getTime();
      if (age < COOLDOWN_MS) {
        return NextResponse.json({
          success: true,
          cached: true,
          xStats: {
            twitter: user.twitter,
            x_followers_count: user.x_followers_count,
            x_following_count: user.x_following_count,
            x_verified: user.x_verified,
            x_display_name: user.x_display_name,
            x_stats_fetched_at: user.x_stats_fetched_at,
          },
        });
      }
    }

    // Fetch fresh stats
    const stats = await fetchXStats(user.twitter);
    if (!stats) {
      return NextResponse.json(
        { error: "Failed to fetch X stats. Try again later." },
        { status: 502 },
      );
    }

    // Update DB
    const { error: updateError } = await supabase
      .from("users")
      .update({
        x_followers_count: stats.followers,
        x_following_count: stats.following,
        x_verified: stats.isVerified,
        x_display_name: stats.displayName,
        x_stats_fetched_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("[x-stats] Update error:", updateError);
    }

    return NextResponse.json({
      success: true,
      cached: false,
      xStats: {
        twitter: user.twitter,
        x_followers_count: stats.followers,
        x_following_count: stats.following,
        x_verified: stats.isVerified,
        x_display_name: stats.displayName,
        x_stats_fetched_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[x-stats] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
