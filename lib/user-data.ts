/**
 * [#563] Shared helper for building user data objects from SteemHunt/Neynar.
 * Also fetches X stats when a twitter handle is available.
 */

import type { SteemhuntUser } from "./farcaster-indexer";
import type { FarcasterProfile } from "./farcaster";
import type { QuotientUserData } from "./quotient";
import { fetchXStats } from "./x-stats";
import type { Database } from "./supabase";

type UserInsert = Database["public"]["Tables"]["users"]["Insert"];

export async function buildUserData(opts: {
  steemhuntUser: SteemhuntUser | null;
  neynarProfile: FarcasterProfile | null;
  verifiedAddresses: string[];
  quotientData: QuotientUserData | null;
}): Promise<UserInsert> {
  const { steemhuntUser, neynarProfile, verifiedAddresses, quotientData } =
    opts;
  const now = new Date().toISOString();

  const base: Partial<UserInsert> = {
    verified_addresses: verifiedAddresses,
    steemhunt_fetched_at: now,
    quotient_score: quotientData?.quotientScore ?? null,
    quotient_rank: quotientData?.quotientRank ?? null,
    quotient_labels: quotientData?.contextLabels ?? null,
    quotient_updated_at: quotientData ? now : null,
  };

  // Fetch X stats if twitter handle available (non-blocking on failure)
  const twitterHandle = steemhuntUser?.twitter ?? null;
  if (twitterHandle) {
    try {
      const xStats = await fetchXStats(twitterHandle);
      if (xStats) {
        base.x_followers_count = xStats.followers;
        base.x_following_count = xStats.following;
        base.x_verified = xStats.isVerified;
        base.x_display_name = xStats.displayName;
        base.x_stats_fetched_at = now;
      }
    } catch {
      // Non-fatal — X stats are optional
    }
  }

  if (steemhuntUser) {
    return {
      ...base,
      fid: steemhuntUser.fid,
      username: steemhuntUser.username,
      display_name: steemhuntUser.displayName,
      pfp_url: steemhuntUser.pfpUrl,
      primary_address:
        steemhuntUser.primaryAddress?.toLowerCase() || null,
      bio: steemhuntUser.bio,
      url: steemhuntUser.url,
      location: steemhuntUser.location,
      twitter: steemhuntUser.twitter,
      github: steemhuntUser.github,
      follower_count: steemhuntUser.followersCount || 0,
      following_count: steemhuntUser.followingCount || 0,
      is_pro_subscriber: steemhuntUser.proSubscribed ?? false,
      spam_label: steemhuntUser.spamLabel,
      fc_created_at: steemhuntUser.createdAt || null,
    } as UserInsert;
  }

  if (neynarProfile) {
    return {
      ...base,
      fid: neynarProfile.fid,
      username: neynarProfile.username,
      display_name: neynarProfile.displayName,
      pfp_url: neynarProfile.pfpUrl,
      bio: neynarProfile.bio,
    } as UserInsert;
  }

  // Wallet-only user (no Farcaster account)
  return {
    ...base,
    fid: null,
    primary_address: verifiedAddresses[0] || null,
  } as UserInsert;
}
