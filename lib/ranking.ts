import { type Address, formatUnits } from "viem";
import { get24hPriceChange, getTokenTVL } from "./price";
import { STORY_FACTORY } from "./contracts/constants";
import type { Database, Storyline, User } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

interface RankedStoryline extends Storyline {
  trendScore: number;
}

/**
 * Compute author reputation score from social/on-chain signals.
 *
 * Normalized to 0-1 from five sub-signals:
 * - Farcaster follower count (log-scaled)
 * - X/Twitter follower count (log-scaled)
 * - X verified status (boolean boost)
 * - Neynar social score (already 0-1)
 * - Quotient on-chain score (0-1000 → 0-1)
 */
function computeAuthorReputation(user: User | null): number {
  if (!user) return 0;

  // Farcaster followers: log-scaled, cap at ~100k
  const fcFollowers = user.follower_count ?? 0;
  const fcSignal = Math.min(1, Math.log10(1 + fcFollowers) / 5);

  // X/Twitter followers: log-scaled, cap at ~100k
  const xFollowers = Number(user.x_followers_count ?? 0);
  const xSignal = Math.min(1, Math.log10(1 + xFollowers) / 5);

  // X verified: boolean boost
  const verifiedSignal = user.x_verified ? 1 : 0;

  // Neynar score: already 0-1
  const neynarSignal = Math.min(1, Math.max(0, Number(user.neynar_score ?? 0)));

  // Quotient score: range 0-1000, normalize to 0-1
  const quotientSignal = Math.min(1, Math.max(0, Number(user.quotient_score ?? 0) / 1000));

  return (
    fcSignal * 0.25 +
    xSignal * 0.6 +
    verifiedSignal * 0.05 +
    neynarSignal * 0.05 +
    quotientSignal * 0.05
  );
}

/**
 * Compute trending score for a storyline.
 *
 * Composite of 6 signals (each normalized to ~0-1 range):
 * - weightedRating: Bayesian rating accounting for rating count (0-5 → 0-1)
 * - priceChange24h: 24h price change % (clamped, mapped to 0-1)
 * - tvl: reserve balance (log-scaled, using actual token decimals)
 * - continuationRate: plots per day since creation
 * - recency: boost for recently updated stories based on last_plot_time
 * - authorReputation: writer's social/on-chain reputation
 */
function computeTrendScore(
  avgRating: number,
  ratingCount: number,
  priceChange: number | null,
  tvlRaw: bigint | null,
  tvlDecimals: number,
  plotCount: number,
  createdAt: string | null,
  lastPlotTime: string | null,
  authorReputation: number,
): number {
  // Bayesian weighted rating signal (0-1), weight: 0.20
  const priorCount = 5;
  const priorMean = 3.0;
  const weightedRating =
    (ratingCount * avgRating + priorCount * priorMean) /
    (ratingCount + priorCount);
  const ratingSignal = weightedRating / 5;

  // Price change signal (0-1), weight: 0.15
  const pc = priceChange ?? 0;
  const clampedPc = Math.max(-100, Math.min(200, pc));
  const priceSignal = (clampedPc + 100) / 300;

  // TVL signal (0-1), weight: 0.15
  let tvlSignal = 0;
  if (tvlRaw !== null && tvlRaw > BigInt(0)) {
    const tvlFloat = Number(formatUnits(tvlRaw, tvlDecimals));
    tvlSignal = Math.min(1, Math.log10(1 + tvlFloat) / 3);
  }

  // Continuation rate signal (0-1), weight: 0.15
  let contSignal = 0;
  if (createdAt && plotCount > 1) {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    const ageDays = Math.max(1, ageMs / (1000 * 60 * 60 * 24));
    contSignal = Math.min(1, (plotCount / ageDays) / 5);
  }

  // Recency signal (0-1), weight: 0.15
  // Uses last_plot_time (falls back to createdAt) with inverse-time decay
  const recencyRef = lastPlotTime ?? createdAt;
  let recencySignal = 0;
  if (recencyRef) {
    const daysSince =
      (Date.now() - new Date(recencyRef).getTime()) / (1000 * 60 * 60 * 24);
    recencySignal = 1 / (1 + Math.max(0, daysSince));
  }

  // Author reputation signal (0-1), weight: 0.20
  const reputationSignal = authorReputation;

  return (
    ratingSignal * 0.2 +
    priceSignal * 0.15 +
    tvlSignal * 0.15 +
    contSignal * 0.15 +
    recencySignal * 0.15 +
    reputationSignal * 0.2
  );
}

/** Shared: fetch storyline candidates + batch ratings */
async function fetchCandidatesAndRatings(
  supabase: SupabaseClient<Database>,
  writerType?: number,
  genre?: string,
  lang?: string,
) {
  function applyBase(q: ReturnType<typeof supabase.from>) {
    let filtered = q
      .eq("hidden", false)
      .eq("sunset", false)
      .neq("token_address", "")
      .eq("contract_address", STORY_FACTORY.toLowerCase());
    if (writerType !== undefined) filtered = filtered.eq("writer_type", writerType);
    if (genre) filtered = filtered.eq("genre", genre);
    if (lang) filtered = filtered.eq("language", lang);
    return filtered;
  }

  // Two pools: newest by creation + recently updated by last_plot_time
  const [byCreated, byActivity] = await Promise.all([
    applyBase(supabase.from("storylines").select("*"))
      .order("block_timestamp", { ascending: false })
      .limit(50),
    applyBase(supabase.from("storylines").select("*"))
      .not("last_plot_time", "is", null)
      .order("last_plot_time", { ascending: false })
      .limit(50),
  ]);

  // Merge and deduplicate by storyline_id
  const seen = new Set<number>();
  const merged: Storyline[] = [];
  for (const sl of [...(byCreated.data ?? []), ...(byActivity.data ?? [])] as Storyline[]) {
    if (!seen.has(sl.storyline_id)) {
      seen.add(sl.storyline_id);
      merged.push(sl);
    }
  }

  const storylines = merged;
  if (storylines.length === 0) return { storylines, ratingMap: new Map<number, { avg: number; count: number }>(), userMap: new Map<string, User>() };

  // Batch: fetch all ratings for candidate storyline IDs in one query
  const storylineIds = storylines.map((sl) => sl.storyline_id);
  const { data: allRatings } = await supabase.from("ratings")
    .select("storyline_id, rating")
    .in("storyline_id", storylineIds)
    .eq("contract_address", STORY_FACTORY.toLowerCase());

  const ratingMap = new Map<number, { avg: number; count: number }>();
  if (allRatings) {
    const grouped = new Map<number, number[]>();
    for (const r of allRatings) {
      const arr = grouped.get(r.storyline_id) ?? [];
      arr.push(r.rating);
      grouped.set(r.storyline_id, arr);
    }
    for (const [id, ratings] of grouped) {
      ratingMap.set(id, {
        avg: ratings.reduce((s, v) => s + v, 0) / ratings.length,
        count: ratings.length,
      });
    }
  }

  // Batch: fetch user rows for all unique writer addresses
  const writerAddresses = [...new Set(storylines.map((sl) => sl.writer_address.toLowerCase()))];
  const userMap = new Map<string, User>();
  if (writerAddresses.length > 0) {
    // Query by primary_address and verified_addresses in parallel
    const [{ data: byPrimary }, { data: byVerified }] = await Promise.all([
      supabase
        .from("users")
        .select("*")
        .in("primary_address", writerAddresses),
      supabase
        .from("users")
        .select("*")
        .overlaps("verified_addresses", writerAddresses),
    ]);

    for (const user of [...(byPrimary ?? []), ...(byVerified ?? [])] as User[]) {
      // Map by primary_address
      if (user.primary_address) {
        userMap.set(user.primary_address.toLowerCase(), user);
      }
      // Map by each verified_address
      if (user.verified_addresses) {
        for (const addr of user.verified_addresses) {
          userMap.set(addr.toLowerCase(), user);
        }
      }
    }
  }

  return { storylines, ratingMap, userMap };
}

/** Shared: enrich a storyline with on-chain signals */
async function enrichWithOnChain(
  sl: Storyline,
): Promise<{ priceChange: number | null; tvlRaw: bigint | null; tvlDecimals: number }> {
  const tokenAddr = sl.token_address as Address;
  const [priceChangeResult, tvlResult] = await Promise.all([
    get24hPriceChange(tokenAddr).catch(() => null),
    getTokenTVL(tokenAddr).catch(() => null),
  ]);

  return {
    priceChange: priceChangeResult?.changePercent ?? null,
    tvlRaw: tvlResult?.tvlRaw ?? null,
    tvlDecimals: tvlResult?.decimals ?? 18,
  };
}

/**
 * Fetch trending storylines ranked by composite score.
 */
export async function getTrendingStorylines(
  supabase: SupabaseClient<Database>,
  limit = 20,
  writerType?: number,
  offset = 0,
  genre?: string,
  lang?: string,
): Promise<RankedStoryline[]> {
  const { storylines, ratingMap, userMap } = await fetchCandidatesAndRatings(supabase, writerType, genre, lang);
  if (storylines.length === 0) return [];

  const enriched = await Promise.all(
    storylines.map(async (sl): Promise<RankedStoryline> => {
      const rating = ratingMap.get(sl.storyline_id) ?? { avg: 0, count: 0 };
      const { priceChange, tvlRaw, tvlDecimals } = await enrichWithOnChain(sl);
      const author = userMap.get(sl.writer_address.toLowerCase()) ?? null;

      const trendScore = computeTrendScore(
        rating.avg,
        rating.count,
        priceChange,
        tvlRaw,
        tvlDecimals,
        sl.plot_count,
        sl.block_timestamp,
        sl.last_plot_time,
        computeAuthorReputation(author),
      );

      return { ...sl, trendScore };
    }),
  );

  enriched.sort((a, b) => b.trendScore - a.trendScore);
  return enriched.slice(offset, offset + limit);
}

