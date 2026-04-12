"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { formatUnits, type Address } from "viem";
import Link from "next/link";
import { supabase, type Storyline, type Donation, type TradeHistory, type User } from "../../../../lib/supabase";
import { STORY_FACTORY, RESERVE_LABEL, EXPLORER_URL, MCV2_BOND, PLOT_TOKEN } from "../../../../lib/contracts/constants";
import { getFullUserProfile, type LinkedAgent } from "../../../../lib/actions";
import { truncateAddress } from "../../../../lib/utils";
import { formatPrice, formatSupply } from "../../../../lib/format";
import { getTokenPrice, mcv2BondAbi, erc20Abi, type TokenPriceInfo, get24hPriceChange, getTokenTVL } from "../../../../lib/price";
import { browserClient } from "../../../../lib/rpc";
import type { FarcasterProfile } from "../../../../lib/farcaster";
import type { AgentMetadata } from "../../../../lib/contracts/erc8004";
import { usePlotUsdPrice } from "../../../hooks/usePlotUsdPrice";
import { formatUsdValue } from "../../../../lib/usd-price";
import { DisconnectButton } from "../../../components/ConnectWallet";
import { GENRES, LANGUAGES } from "../../../../lib/genres";
import { DeadlineCountdown } from "../../../components/DeadlineCountdown";
import { ClaimRoyalties } from "../../../components/ClaimRoyalties";
import { WriterTradingStats } from "../../../components/WriterTradingStats";
import { DropdownSelect } from "../../../components/DropdownSelect";

type Tab = "stories" | "portfolio" | "activity";


export default function ProfilePage() {
  const params = useParams<{ address: string }>();
  const address = params.address.toLowerCase();
  const { address: connectedAddress } = useAccount();
  const isOwnProfile = connectedAddress?.toLowerCase() === address;
  const queryClient = useQueryClient();

  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "stories";
  const [tab, setTab] = useState<Tab>(
    ["stories", "portfolio", "activity"].includes(initialTab) ? initialTab : "stories"
  );

  // Unified profile fetch: single DB lookup, derives FC + agent from shared result
  const { data: fullProfile, isLoading: profileLoading } = useQuery({
    queryKey: ["full-profile", address],
    queryFn: () => getFullUserProfile(address),
  });

  const dbUser = fullProfile?.dbUser ?? null;
  const fcProfile = fullProfile?.fcProfile ?? null;
  const fcLoading = profileLoading;
  const agentMeta = fullProfile?.agentMeta ?? null;
  const agentLoading = profileLoading;
  const isAgent = !profileLoading && agentMeta !== null && agentMeta !== undefined;
  const linkedAgent = fullProfile?.linkedAgent ?? null;

  // Cumulative claimed royalties (on-chain)
  const { data: claimedRoyalties } = useQuery({
    queryKey: ["profile-claimed-royalties", address],
    queryFn: async () => {
      const [, claimed] = await browserClient.readContract({
        address: MCV2_BOND,
        abi: mcv2BondAbi,
        functionName: "getRoyaltyInfo",
        args: [address as Address, PLOT_TOKEN],
      });
      return claimed;
    },
  });

  // PLOT token balance (on-chain)
  const { data: plotBalance } = useQuery({
    queryKey: ["profile-plot-balance", address],
    queryFn: async () => {
      return browserClient.readContract({
        address: PLOT_TOKEN,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as Address],
      });
    },
  });
  const { data: plotUsdPrice } = usePlotUsdPrice();

  // Refresh profile handler (5-min cooldown enforced server-side)
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/user/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address, forceRefresh: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429 && data.cooldownRemainingSeconds) {
          setRefreshError(`Cooldown: ${Math.ceil(data.cooldownRemainingSeconds / 60)}m remaining`);
        } else {
          setRefreshError(data.error || "Refresh failed");
        }
      } else {
        // Invalidate queries to show fresh data
        queryClient.invalidateQueries({ queryKey: ["db-user", address] });
        queryClient.invalidateQueries({ queryKey: ["fc-profile", address] });
      }
    } catch {
      setRefreshError("Network error");
    } finally {
      setRefreshing(false);
    }
  }, [address, queryClient]);

  // Proactive cooldown timer based on DB steemhunt_fetched_at
  const COOLDOWN_MS = 5 * 60 * 1000;
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  useEffect(() => {
    if (!dbUser?.steemhunt_fetched_at) {
      setCooldownRemaining(0);
      return;
    }
    const computeRemaining = () => {
      const age = Date.now() - new Date(dbUser.steemhunt_fetched_at!).getTime();
      return Math.max(0, COOLDOWN_MS - age);
    };
    setCooldownRemaining(computeRemaining());
    const interval = setInterval(() => {
      const r = computeRemaining();
      setCooldownRemaining(r);
      if (r <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [dbUser?.steemhunt_fetched_at]);

  const onCooldown = cooldownRemaining > 0;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <ProfileHeader
        address={address}
        fcProfile={fcProfile ?? null}
        fcLoading={fcLoading}
        agentMeta={agentMeta ?? null}
        agentLoading={agentLoading}
        isAgent={isAgent}
        linkedAgent={linkedAgent}
        claimedRoyalties={claimedRoyalties ?? null}
        plotBalance={plotBalance ?? null}
        plotUsdPrice={plotUsdPrice ?? null}
        dbUser={dbUser ?? null}
        isOwnProfile={isOwnProfile}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        refreshError={refreshError}
        onCooldown={onCooldown}
        cooldownRemaining={cooldownRemaining}
      />

      {/* Tab navigation */}
      <div className="mt-8 flex gap-2 border-b border-[var(--border)] pb-2">
        {(["stories", "portfolio", "activity"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t === "stories" ? "Writer" : t === "portfolio" ? "Reader" : "Activity"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "stories" && (
        <StoriesTab
          address={address}
          isAgent={isAgent}
          agentMeta={agentMeta ?? null}
          isOwnProfile={isOwnProfile}
          connectedAddress={connectedAddress ?? null}
          claimedRoyalties={claimedRoyalties}
        />
      )}
      {tab === "portfolio" && <PortfolioTab address={address} isOwnProfile={isOwnProfile} />}
      {tab === "activity" && <ActivityTab address={address} />}
    </div>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Profile Header — Social Credibility Trust Dashboard
// ---------------------------------------------------------------------------

function ProfileHeader({
  address,
  fcProfile,
  fcLoading,
  agentMeta,
  agentLoading,
  isAgent,
  linkedAgent,
  claimedRoyalties,
  plotBalance,
  plotUsdPrice,
  dbUser,
  isOwnProfile,
  onRefresh,
  refreshing,
  refreshError,
  onCooldown,
  cooldownRemaining,
}: {
  address: string;
  fcProfile: FarcasterProfile | null;
  fcLoading: boolean;
  agentMeta: AgentMetadata | null;
  agentLoading: boolean;
  isAgent: boolean;
  linkedAgent: LinkedAgent | null;
  claimedRoyalties: bigint | null;
  plotBalance: bigint | null;
  plotUsdPrice: number | null;
  dbUser: User | null;
  isOwnProfile: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  refreshError: string | null;
  onCooldown: boolean;
  cooldownRemaining: number;
}) {
  const displayName = agentMeta?.name ?? fcProfile?.displayName ?? null;
  const hasFarcaster = dbUser?.fid != null && dbUser?.username != null;
  const hasX = dbUser?.twitter != null;
  const hasQuotient = dbUser?.quotient_score != null;

  return (
    <header className="space-y-5 pb-6">
      {/* Primary identity */}
      <div className="flex items-start gap-4">
        {fcProfile?.pfpUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fcProfile.pfpUrl}
            alt=""
            width={72}
            height={72}
            className="rounded-full border-2 border-[var(--border)]"
          />
        ) : (
          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-[var(--border)] text-xl font-bold text-[var(--text-muted)]">
            {address.slice(2, 4).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className={`font-body font-bold tracking-tight text-accent break-words ${
              (displayName ?? "").length > 14 ? "text-lg sm:text-2xl" : "text-xl sm:text-2xl"
            }`}>
              {fcLoading && agentLoading
                ? truncateAddress(address)
                : displayName ?? truncateAddress(address)}
            </h1>
            {!agentLoading && (
              isAgent ? (
                <span className="bg-accent/10 text-accent shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium">
                  AI Agent
                </span>
              ) : (
                <span className="border-border text-muted shrink-0 rounded border px-1.5 py-0.5 text-[10px]">
                  Human
                </span>
              )
            )}
            {isOwnProfile && <DisconnectButton />}
          </div>

          {/* Bio */}
          {agentMeta?.description ? (
            <p className="text-muted mt-1 text-xs">{agentMeta.description}</p>
          ) : fcProfile?.bio ? (
            <p className="text-muted mt-1 text-xs">{fcProfile.bio}</p>
          ) : null}

        </div>
      </div>

      {/* Trust dashboard — social credibility cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Farcaster card */}
        {hasFarcaster && (
          <div className="border-border rounded border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-muted text-[10px] font-medium uppercase tracking-wider">Farcaster</span>
              <div className="flex items-center gap-1">
                {dbUser?.power_badge && (
                  <span className="bg-purple-500/10 text-purple-600 rounded px-1 py-0.5 text-[9px] font-medium">Power</span>
                )}
                {dbUser?.is_pro_subscriber && (
                  <span className="bg-accent/10 text-accent rounded px-1 py-0.5 text-[9px] font-medium">Pro</span>
                )}
              </div>
            </div>
            <a
              href={`https://farcaster.com/${dbUser!.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:text-accent text-sm font-medium transition-colors"
            >
              @{dbUser!.username}
            </a>
            <span className="text-muted ml-2 text-[10px]">FID {dbUser!.fid}</span>
            <div className="mt-2 flex gap-4 text-xs">
              <div>
                <span className="text-foreground font-mono font-medium">
                  {(dbUser?.follower_count ?? 0).toLocaleString()}
                </span>
                <span className="text-muted ml-1">followers</span>
              </div>
              <div>
                <span className="text-foreground font-mono font-medium">
                  {(dbUser?.following_count ?? 0).toLocaleString()}
                </span>
                <span className="text-muted ml-1">following</span>
              </div>
            </div>
          </div>
        )}

        {/* X/Twitter card */}
        {hasX && (
          <div className="border-border rounded border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-muted text-[10px] font-medium uppercase tracking-wider">X / Twitter</span>
              {dbUser.x_verified && (
                <span className="bg-blue-500/10 text-blue-500 rounded px-1 py-0.5 text-[9px] font-medium">Verified</span>
              )}
            </div>
            <a
              href={`https://x.com/${dbUser.twitter}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:text-accent text-sm font-medium transition-colors"
            >
              @{dbUser.twitter}
            </a>
            {dbUser.x_display_name && dbUser.x_display_name !== dbUser.twitter && (
              <span className="text-muted ml-2 text-[11px]">{dbUser.x_display_name}</span>
            )}
            {(dbUser.x_followers_count != null || dbUser.x_following_count != null) && (
              <div className="mt-2 flex gap-4 text-xs">
                {dbUser.x_followers_count != null && (
                  <div>
                    <span className="text-foreground font-mono font-medium">
                      {dbUser.x_followers_count.toLocaleString()}
                    </span>
                    <span className="text-muted ml-1">followers</span>
                  </div>
                )}
                {dbUser.x_following_count != null && (
                  <div>
                    <span className="text-foreground font-mono font-medium">
                      {dbUser.x_following_count.toLocaleString()}
                    </span>
                    <span className="text-muted ml-1">following</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Quotient Score card */}
        {hasQuotient && (
          <div className="border-border rounded border p-3">
            <span className="text-muted text-[10px] font-medium uppercase tracking-wider">Quotient Score</span>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-accent font-mono text-xl font-bold">{dbUser!.quotient_score}</span>
              {dbUser!.quotient_rank != null && (
                <span className="text-muted text-[11px]">Rank #{dbUser!.quotient_rank.toLocaleString()}</span>
              )}
            </div>
          </div>
        )}

        {/* Agent Identity card — shown for registered agents */}
        {isAgent && agentMeta && (
          <div className="border-border rounded border p-3">
            <div className="flex items-center justify-between">
              <span className="text-muted text-[10px] font-medium uppercase tracking-wider">Agent Identity</span>
              <span className="bg-accent/10 text-accent rounded px-1 py-0.5 text-[9px] font-medium">ERC-8004</span>
            </div>
            <div className="mt-1.5 space-y-1.5">
              {agentMeta.agentId && (
                <div className="text-xs">
                  <span className="text-muted">Agent ID: </span>
                  <span className="text-foreground font-mono font-medium">{agentMeta.agentId}</span>
                </div>
              )}
              <div className="text-xs">
                <span className="text-muted">Name: </span>
                <span className="text-foreground font-medium">{agentMeta.name}</span>
              </div>
              {agentMeta.llmModel && (
                <div className="text-xs">
                  <span className="text-muted">Model: </span>
                  <span className="text-foreground font-medium">{agentMeta.llmModel}</span>
                </div>
              )}
              {agentMeta.genre && (
                <div className="text-xs">
                  <span className="text-muted">Genre: </span>
                  <span className="text-foreground">{agentMeta.genre}</span>
                </div>
              )}
              {agentMeta.registeredAt && (
                <div className="text-xs">
                  <span className="text-muted">Registered: </span>
                  <span className="text-foreground">
                    {new Date(agentMeta.registeredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
              )}
              {agentMeta.owner && agentMeta.owner.toLowerCase() !== address.toLowerCase() && (
                <div className="text-xs">
                  <span className="text-muted">Owner: </span>
                  <Link href={`/profile/${agentMeta.owner}`} className="text-accent hover:underline font-mono text-[11px]">
                    {agentMeta.owner.slice(0, 6)}...{agentMeta.owner.slice(-4)}
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Linked AI Writer card — shown for owners with a separate agent wallet */}
        {!isAgent && linkedAgent && (
          <div className="border-border rounded border p-3">
            <span className="text-muted text-[10px] font-medium uppercase tracking-wider">Linked AI Writer</span>
            <div className="mt-1.5">
              <Link href={`/profile/${linkedAgent.agentWallet}`} className="text-accent hover:underline text-sm font-medium">
                {linkedAgent.name}
              </Link>
              <span className="text-muted text-xs ml-1.5">#{linkedAgent.agentId}</span>
            </div>
          </div>
        )}

        {/* Wallet identity card — always shown */}
        <div className="border-border rounded border p-3">
          <span className="text-muted text-[10px] font-medium uppercase tracking-wider">Wallet</span>
          <div className="mt-1.5 flex items-center gap-1.5">
            <a
              href={`${EXPLORER_URL}/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:text-accent font-mono text-sm transition-colors"
            >
              {truncateAddress(address)}
            </a>
            <CopyButton text={address} />
          </div>
          {plotBalance != null && (
            <div className="text-muted mt-1.5 text-[11px]">
              Balance: <span className="text-foreground font-medium">{Number(formatUnits(plotBalance, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLOT</span>
              {plotUsdPrice != null && (
                <span className="text-muted"> (≈ {formatUsdValue(Number(formatUnits(plotBalance, 18)) * plotUsdPrice)})</span>
              )}
            </div>
          )}
          {claimedRoyalties != null && claimedRoyalties > BigInt(0) && (
            <div className="text-muted mt-1.5 text-[11px]">
              Royalties: <span className="text-green-700 font-medium">{formatPrice(formatUnits(claimedRoyalties, 18))} {RESERVE_LABEL}</span>
              {plotUsdPrice != null && (
                <span className="text-muted"> (≈ {formatUsdValue(Number(formatUnits(claimedRoyalties, 18)) * plotUsdPrice)})</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Refresh button (own profile only) */}
      {isOwnProfile && (
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={refreshing || onCooldown}
            className="border-border text-muted hover:text-accent hover:border-accent rounded border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50"
          >
            {(() => {
              if (refreshing) return "Refreshing...";
              if (!onCooldown) return "Refresh Profile";
              const totalSec = Math.ceil(cooldownRemaining / 1000);
              const m = Math.floor(totalSec / 60);
              const s = totalSec % 60;
              return `Refresh (${m}m ${s}s)`;
            })()}
          </button>
          {refreshError && (
            <span className="text-[11px] text-red-500">{refreshError}</span>
          )}
        </div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Copy to clipboard button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-muted hover:text-accent text-[10px] transition-colors"
      title="Copy address"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stories Tab — writer stats + story portfolio
// ---------------------------------------------------------------------------

function StoriesTab({
  address,
  isAgent,
  agentMeta,
  isOwnProfile,
  connectedAddress,
  claimedRoyalties,
}: {
  address: string;
  isAgent: boolean;
  agentMeta: AgentMetadata | null;
  isOwnProfile: boolean;
  connectedAddress: string | null;
  claimedRoyalties?: bigint;
}) {
  const { data: plotUsd } = usePlotUsdPrice();
  const { data: storylines = [], isLoading, error } = useQuery({
    queryKey: ["profile-storylines", address],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("storylines")
        .select("*")
        .eq("writer_address", address)
        .eq("hidden", false)
        .eq("contract_address", STORY_FACTORY.toLowerCase())
        .order("block_timestamp", { ascending: false })
        .returns<Storyline[]>();
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch donations received as writer (across all storylines)
  const storylineIds = storylines.map((s) => s.storyline_id);
  const { data: donationsReceived = [] } = useQuery({
    queryKey: ["profile-donations-received", address, storylineIds],
    queryFn: async () => {
      if (!supabase || storylineIds.length === 0) return [];
      const { data } = await supabase
        .from("donations")
        .select("amount")
        .in("storyline_id", storylineIds)
        .eq("contract_address", STORY_FACTORY.toLowerCase());
      return (data ?? []) as { amount: string }[];
    },
    enabled: storylineIds.length > 0,
  });

  // Batch-fetch average ratings for all storylines
  const { data: ratingsMap = new Map<number, { average: number; count: number }>() } = useQuery({
    queryKey: ["profile-ratings-batch", storylineIds],
    queryFn: async () => {
      if (!supabase || storylineIds.length === 0) return new Map<number, { average: number; count: number }>();
      const { data } = await supabase
        .from("ratings")
        .select("storyline_id, rating")
        .in("storyline_id", storylineIds)
        .eq("contract_address", STORY_FACTORY.toLowerCase());
      const map = new Map<number, { average: number; count: number }>();
      if (!data) return map;
      const grouped = new Map<number, number[]>();
      for (const r of data as { storyline_id: number; rating: number }[]) {
        const arr = grouped.get(r.storyline_id) ?? [];
        arr.push(r.rating);
        grouped.set(r.storyline_id, arr);
      }
      for (const [sid, ratings] of grouped) {
        const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
        map.set(sid, { average: avg, count: ratings.length });
      }
      return map;
    },
    enabled: storylineIds.length > 0,
  });

  // Total token holders across all writer's storylines (on-chain balanceOf)
  const { data: totalHolders } = useQuery({
    queryKey: ["profile-total-holders", address, storylineIds],
    queryFn: async () => {
      if (!supabase || storylineIds.length === 0) return 0;
      // Get unique trader addresses across all storylines
      const { data: trades } = await supabase
        .from("trade_history")
        .select("user_address, storyline_id")
        .in("storyline_id", storylineIds)
        .eq("contract_address", MCV2_BOND.toLowerCase());
      if (!trades || trades.length === 0) return 0;

      // Build map: token_address -> unique user addresses
      const tokenByStoryline = new Map<number, string>();
      for (const s of storylines) {
        if (s.token_address) tokenByStoryline.set(s.storyline_id, s.token_address);
      }

      // Deduplicate: (user, token) pairs
      const pairs = new Set<string>();
      const pairList: { user: string; token: string }[] = [];
      for (const t of trades as { user_address: string | null; storyline_id: number }[]) {
        if (!t.user_address) continue;
        const token = tokenByStoryline.get(t.storyline_id);
        if (!token) continue;
        const key = `${t.user_address}:${token}`;
        if (!pairs.has(key)) {
          pairs.add(key);
          pairList.push({ user: t.user_address, token });
        }
      }
      if (pairList.length === 0) return 0;

      // Multicall balanceOf for each (user, token) pair
      const results = await browserClient.multicall({
        contracts: pairList.map((p) => ({
          address: p.token as Address,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [p.user as Address],
        })),
        allowFailure: true,
      });

      let holders = 0;
      const counted = new Set<string>();
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "success" && (r.result as bigint) > BigInt(0)) {
          const userKey = pairList[i].user.toLowerCase();
          if (!counted.has(userKey)) {
            counted.add(userKey);
            holders++;
          }
        }
      }
      return holders;
    },
    enabled: storylineIds.length > 0,
    staleTime: 60000,
  });

  // Claimable royalties (own profile only)
  const { data: royaltyInfo } = useQuery({
    queryKey: ["profile-royalties", address],
    queryFn: async () => {
      const [balance, claimed] = await browserClient.readContract({
        address: MCV2_BOND,
        abi: mcv2BondAbi,
        functionName: "getRoyaltyInfo",
        args: [address as Address, PLOT_TOKEN],
      });
      return { unclaimed: balance, claimed };
    },
    enabled: isOwnProfile,
  });

  if (isLoading) return <p className="text-muted mt-8 text-sm">Loading...</p>;
  if (error) return <p className="mt-8 text-sm text-error">Failed to load storylines.</p>;
  if (storylines.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted text-sm">No storylines yet.</p>
        <p className="text-muted mt-1 text-xs">
          This address hasn&apos;t created any stories on PlotLink.
        </p>
      </div>
    );
  }

  // Compute writer stats
  const totalPlots = storylines.reduce((sum, s) => sum + s.plot_count, 0);
  const totalDonations = donationsReceived.reduce(
    (sum, d) => sum + BigInt(d.amount),
    BigInt(0),
  );

  // Agent extras
  const avgPlotsPerStory = storylines.length > 0
    ? (totalPlots / storylines.length).toFixed(1)
    : "0";
  const genreCounts = new Map<string, number>();
  for (const s of storylines) {
    if (s.genre) genreCounts.set(s.genre, (genreCounts.get(s.genre) ?? 0) + 1);
  }
  const sortedGenres = Array.from(genreCounts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mt-6 space-y-4">
      {/* Writer Stats — title outside box */}
      <p className="text-muted text-[10px] uppercase tracking-wider">Writer Stats</p>
      <div className="border-border rounded border px-4 py-3 text-xs space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="border-border rounded border px-2 py-1.5 text-center">
            <div className="text-foreground text-sm font-bold">{storylines.length}</div>
            <div className="text-muted text-[9px]">Stories</div>
          </div>
          <div className="border-border rounded border px-2 py-1.5 text-center">
            <div className="text-foreground text-sm font-bold">{totalPlots}</div>
            <div className="text-muted text-[9px]">Plots</div>
          </div>
          <div className="border-border rounded border px-2 py-1.5 text-center">
            <div className="text-foreground text-sm font-bold">{totalHolders !== undefined ? totalHolders : "—"}</div>
            <div className="text-muted text-[9px]">Holders</div>
          </div>
          <div className="border-border rounded border px-2 py-1.5 text-center">
            <div className="text-foreground text-sm font-bold">{storylines.reduce((sum, s) => sum + (s.view_count ?? 0), 0)}</div>
            <div className="text-muted text-[9px]">Views</div>
          </div>
        </div>
        <div className="border-border rounded border px-3 py-1.5">
          <span className="text-muted">Donations Received:</span>{" "}
          {totalDonations > BigInt(0) ? (
            <>
              <span className="text-foreground font-medium">
                {plotUsd != null ? formatUsdValue(Number(formatUnits(totalDonations, 18)) * plotUsd) : `${formatPrice(formatUnits(totalDonations, 18))} ${RESERVE_LABEL}`}
              </span>
              {plotUsd != null && (
                <span className="text-muted"> ({formatPrice(formatUnits(totalDonations, 18))} {RESERVE_LABEL})</span>
              )}
            </>
          ) : (
            <span className="text-foreground font-medium">—</span>
          )}
        </div>
        {claimedRoyalties !== undefined && claimedRoyalties > BigInt(0) && (
          <div className="border-border rounded border px-3 py-1.5">
            <span className="text-muted">Royalties Claimed:</span>{" "}
            <span className="text-foreground font-medium">
              {plotUsd != null ? formatUsdValue(Number(formatUnits(claimedRoyalties, 18)) * plotUsd) : `${formatPrice(formatUnits(claimedRoyalties, 18))} ${RESERVE_LABEL}`}
            </span>
            {plotUsd != null && (
              <span className="text-muted"> ({formatPrice(formatUnits(claimedRoyalties, 18))} {RESERVE_LABEL})</span>
            )}
          </div>
        )}
      </div>

      {/* Agent extras */}
      {isAgent && (
        <div className="border-border bg-surface rounded border px-4 py-3">
          <p className="text-muted mb-2 text-[10px] uppercase tracking-wider">Agent Insights</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="text-muted">
              Avg plots/story: <span className="text-foreground font-medium">{avgPlotsPerStory}</span>
            </span>
            {agentMeta?.llmModel && (
              <span className="text-muted">
                Model: <span className="text-foreground font-medium">{agentMeta.llmModel}</span>
              </span>
            )}
          </div>
          {sortedGenres.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sortedGenres.map(([genre, count]) => (
                <span
                  key={genre}
                  className="rounded-sm bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] text-[var(--accent)]"
                >
                  {genre} ({count})
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stories */}
      <p className="text-muted text-[10px] uppercase tracking-wider">Stories</p>
      <div className="space-y-4">
        {storylines.map((s) => (
          <StoryRow
            key={s.id}
            storyline={s}
            isOwnProfile={isOwnProfile}
            writerAddress={connectedAddress as Address}
            plotUsd={plotUsd}
            ratingData={ratingsMap.get(s.storyline_id)}
          />
        ))}
      </div>
    </div>
  );
}

function StoryRow({
  storyline,
  isOwnProfile,
  writerAddress,
  plotUsd,
  ratingData,
}: {
  storyline: Storyline;
  isOwnProfile: boolean;
  writerAddress: Address;
  plotUsd?: number | null;
  ratingData?: { average: number; count: number };
}) {
  const tokenAddr = storyline.token_address as Address;

  const { data: priceInfo } = useQuery({
    queryKey: ["profile-story-price", storyline.token_address],
    queryFn: () => getTokenPrice(tokenAddr, browserClient),
    enabled: !!storyline.token_address,
    staleTime: 60000,
  });

  // On-chain holder count via balanceOf multicall
  const { data: holderCount } = useQuery({
    queryKey: ["profile-story-holders", storyline.storyline_id, storyline.token_address],
    queryFn: async () => {
      if (!supabase || !storyline.token_address) return 0;
      const { data: trades } = await supabase
        .from("trade_history")
        .select("user_address")
        .eq("storyline_id", storyline.storyline_id)
        .eq("contract_address", MCV2_BOND.toLowerCase());
      if (!trades || trades.length === 0) return 0;

      const uniqueUsers = [...new Set(
        (trades as { user_address: string | null }[])
          .map((t) => t.user_address)
          .filter(Boolean) as string[]
      )];
      if (uniqueUsers.length === 0) return 0;

      const results = await browserClient.multicall({
        contracts: uniqueUsers.map((u) => ({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [u as Address],
        })),
        allowFailure: true,
      });

      return results.filter(
        (r) => r.status === "success" && (r.result as bigint) > BigInt(0),
      ).length;
    },
    staleTime: 60000,
    enabled: !!storyline.token_address,
  });

  return (
    <>
    <div className="border-border rounded border divide-y divide-border text-xs">
      {/* Moleskine book (left) + Info (right) */}
      <div className="flex flex-row items-center gap-4 px-4 py-3">
        {/* Moleskine book card */}
        <Link
          href={`/story/${storyline.storyline_id}`}
          className="moleskine-notebook group relative block shrink-0 w-[130px] sm:w-[180px]"
        >
          <div
            className="notebook-cover relative z-10 flex flex-col overflow-hidden border border-[var(--border)]"
            style={{
              aspectRatio: "2/3",
              borderRadius: "5px 12px 12px 5px",
              backgroundColor: "#F5EFE6",
              boxShadow: "2px 4px 8px rgba(44, 24, 16, 0.08)",
            }}
          >
            <div
              className="pointer-events-none absolute inset-y-[-1px] right-[16px] z-20 w-[5px] rounded-[2px]"
              style={{ background: "rgba(139, 69, 19, 0.15)" }}
            />
            <div className="relative z-10 px-2.5 pt-2.5">
              <span className="rounded-sm bg-[var(--accent)]/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-widest text-[var(--accent)]">
                {storyline.genre || "Uncategorized"}
              </span>
            </div>
            <div className="relative z-10 flex flex-1 items-center justify-center px-3 text-center">
              <span className="font-heading text-sm sm:text-base font-bold leading-tight text-[var(--accent)]">
                {storyline.title}
              </span>
            </div>
            <div className="relative z-10 px-2.5 pb-2.5">
              <span className="text-[8px] text-[var(--text-muted)]">
                {storyline.plot_count} {storyline.plot_count === 1 ? "plot" : "plots"}
              </span>
            </div>
          </div>
        </Link>

        {/* Info (right) */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="grid grid-cols-2 gap-2">
            <div className="border-border rounded border px-2 py-1.5 text-center">
              <div className="text-foreground text-sm font-bold">{storyline.plot_count}</div>
              <div className="text-muted text-[9px]">Plots</div>
            </div>
            <div className="border-border rounded border px-2 py-1.5 text-center">
              <div className="text-foreground text-sm font-bold">{holderCount ?? "—"}</div>
              <div className="text-muted text-[9px]">Holders</div>
            </div>
            <div className="border-border rounded border px-2 py-1.5 text-center">
              <div className="text-foreground text-sm font-bold">{formatViewCount(storyline.view_count)}</div>
              <div className="text-muted text-[9px]">Views</div>
            </div>
            <div className="border-border rounded border px-2 py-1.5 text-center">
              <div className="text-foreground text-sm font-bold">{ratingData && ratingData.count > 0 ? ratingData.average.toFixed(1) : "—"}</div>
              <div className="text-muted text-[9px]">Rating</div>
            </div>
          </div>
          {/* TVL + Donations (inline in info area) */}
          {storyline.token_address && (
            <>
              <div className="space-y-0.5">
                <WriterTradingStats storyline={storyline} plotUsd={plotUsd} showPrice={false} />
                <StoryDonationCount storylineId={storyline.storyline_id} tokenAddress={storyline.token_address} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Status + Created + Deadline */}
      <div className="px-4 py-2 text-xs space-y-0.5">
        <div className="flex items-center gap-2">
          {!storyline.sunset && storyline.has_deadline && storyline.last_plot_time && (
            <>
              <DeadlineCountdown lastPlotTime={storyline.last_plot_time} />
              <span className="text-muted">·</span>
            </>
          )}
          {storyline.sunset ? (
            <span className="border-border text-muted rounded border px-1.5 py-0.5 text-[10px]">complete</span>
          ) : (
            <span className="border border-green-700/30 text-green-700 rounded px-1.5 py-0.5 text-[10px]">active</span>
          )}
        </div>
        <div>
          <span className="text-muted">Created:</span>{" "}
          <span className="text-foreground font-medium">{storyline.block_timestamp ? new Date(storyline.block_timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</span>
        </div>
      </div>

      {/* Royalties — own profile */}
      {isOwnProfile && storyline.token_address && (
        <div className="px-4 py-2">
          <ClaimRoyalties
            tokenAddress={storyline.token_address as Address}
            plotCount={storyline.plot_count}
            beneficiary={writerAddress}
            plotUsd={plotUsd}
          />
        </div>
      )}

    </div>
    {/* Genre prompt — outside the card */}
    {isOwnProfile && !storyline.genre && (
      <div className="mt-2">
        <GenrePrompt
          storylineId={storyline.storyline_id}
          language={storyline.language}
          writerAddress={writerAddress}
        />
      </div>
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Genre Prompt — for setting genre on own profile storylines
// ---------------------------------------------------------------------------

const genreOptions = [
  { value: "", label: "Select genre..." },
  ...GENRES.map((g) => ({ value: g, label: g })),
];
const languageOptions = LANGUAGES.map((l) => ({ value: l, label: l }));

function GenrePrompt({
  storylineId,
  language,
  writerAddress,
}: {
  storylineId: number;
  language: string;
  writerAddress: string;
}) {
  const [genre, setGenre] = useState("");
  const [lang, setLang] = useState(language || "English");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { signMessageAsync } = useSignMessage();

  async function handleSave() {
    if (!genre) return;
    setSaving(true);
    setErr(null);
    try {
      const langValue = language ? "" : lang;
      const message = `Update storyline ${storylineId} metadata genre:${genre} language:${langValue}`;
      const signature = await signMessageAsync({ message });

      const res = await fetch(`/api/storyline/${storylineId}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genre,
          ...(language ? {} : { language: lang }),
          address: writerAddress,
          signature,
          message,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error (${res.status})`);
      }
      queryClient.invalidateQueries({ queryKey: ["profile-storylines"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-accent/30 bg-surface mt-2 rounded border px-3 py-2.5">
      <p className="text-foreground text-xs font-medium">
        Set your genre
        <span className="text-muted font-normal">
          {" — "}improve discoverability by categorizing your story.
        </span>
      </p>
      <div className="mt-2 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <DropdownSelect
            value={genre}
            onChange={setGenre}
            options={genreOptions}
            placeholder="Select genre..."
            disabled={saving}
          />
        </div>
        {!language && (
          <div className="min-w-0 flex-1">
            <DropdownSelect
              value={lang}
              onChange={setLang}
              options={languageOptions}
              disabled={saving}
            />
          </div>
        )}
        <button
          onClick={handleSave}
          disabled={!genre || saving}
          className="border-accent text-accent hover:bg-accent hover:text-background shrink-0 rounded border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {err && <p className="text-error mt-1 text-[10px]">{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donation History — own profile storyline donations
// ---------------------------------------------------------------------------

const DONATION_PAGE_SIZE = 10;

function ProfileDonationHistory({ storylineId }: { storylineId: number }) {
  const { data: plotUsd } = usePlotUsdPrice();
  const {
    data,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ["profile-donations", storylineId],
    queryFn: async ({ pageParam = 0 }) => {
      if (!supabase) return { rows: [] as Donation[], totalCount: 0 };
      const { data: rows, count } = await supabase
        .from("donations")
        .select("*", { count: "exact" })
        .eq("storyline_id", storylineId)
        .eq("contract_address", STORY_FACTORY.toLowerCase())
        .order("block_timestamp", { ascending: false })
        .range(pageParam, pageParam + DONATION_PAGE_SIZE - 1)
        .returns<Donation[]>();
      return { rows: rows ?? [], totalCount: count ?? 0 };
    },
    initialPageParam: 0,
    getNextPageParam: (_lastPage, allPages) => {
      const totalFetched = allPages.reduce((sum, p) => sum + p.rows.length, 0);
      const totalCount = allPages[0]?.totalCount ?? 0;
      return totalFetched < totalCount ? totalFetched : undefined;
    },
  });

  const donations = data?.pages.flatMap((p) => p.rows) ?? [];
  const totalCount = data?.pages[0]?.totalCount ?? 0;

  if (donations.length === 0) return null;

  return (
    <div className="mt-3">
      <span className="text-muted block text-[10px] uppercase tracking-wider">
        Donation History
      </span>
      <div className="mt-1 space-y-1">
        {donations.map((d) => (
          <div
            key={d.id}
            className="text-muted flex items-center justify-between text-xs"
          >
            <div className="flex gap-2">
              <a
                href={`/profile/${d.donor_address}`}
                className="text-foreground hover:text-accent transition-colors"
              >
                {truncateAddress(d.donor_address)}
              </a>
              {d.block_timestamp && (
                <time dateTime={d.block_timestamp}>
                  {new Date(d.block_timestamp).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-accent font-medium">
                {formatPrice(formatUnits(BigInt(d.amount), 18))} {RESERVE_LABEL}
              </span>
              {plotUsd != null && (
                <span className="text-muted">(≈ {formatUsdValue(Number(formatUnits(BigInt(d.amount), 18)) * plotUsd)})</span>
              )}
              {d.tx_hash && (
                <a
                  href={`${EXPLORER_URL}/tx/${d.tx_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-accent transition-colors"
                  title="View on Basescan"
                >
                  &#x2197;
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="text-accent hover:text-foreground mt-2 w-full text-center text-xs transition-colors disabled:opacity-50"
        >
          {isFetchingNextPage ? "Loading..." : `Load more (${totalCount - donations.length} remaining)`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donation Count — inline stat for own profile story cards
// ---------------------------------------------------------------------------

function StoryDonationCount({ storylineId, tokenAddress }: { storylineId: number; tokenAddress: string }) {
  const { data: plotUsd } = usePlotUsdPrice();
  const { data } = useQuery({
    queryKey: ["story-donation-count", storylineId, tokenAddress],
    queryFn: async () => {
      if (!supabase) return { total: BigInt(0), count: 0 };
      const rows = await supabase
        .from("donations")
        .select("amount")
        .eq("storyline_id", storylineId)
        .eq("contract_address", STORY_FACTORY.toLowerCase())
        .then((r: { data: { amount: string }[] | null }) => r.data);
      if (!rows || rows.length === 0) return { total: BigInt(0), count: 0 };
      const total = rows.reduce((sum, d) => sum + BigInt(d.amount), BigInt(0));
      return { total, count: rows.length };
    },
  });

  if (!data || data.count === 0) {
    return (
      <div className="text-xs">
        <span className="text-muted">Donations:</span> <span className="text-foreground font-medium">—</span>
      </div>
    );
  }

  return (
    <div className="text-xs">
      <span className="text-muted">Donations:</span>{" "}
      <span className="text-foreground font-medium">{formatPrice(formatUnits(data.total, 18))} {RESERVE_LABEL}</span>
      {plotUsd != null && (
        <span className="text-muted"> ({formatUsdValue(Number(formatUnits(data.total, 18)) * plotUsd)})</span>
      )}
      <span className="text-muted"> &times;{data.count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portfolio Tab
// ---------------------------------------------------------------------------

interface PortfolioHolding {
  storyline: Storyline;
  balance: bigint;
  price: bigint;
  value: bigint;
  entryPrice: number | null;
  lastTraded: string | null;
  firstTraded: string | null;
  priceChange: number | null;
  reserveDecimals: number;
}

function PortfolioTab({ address, isOwnProfile }: { address: string; isOwnProfile: boolean }) {
  const { data: plotUsd } = usePlotUsdPrice();

  // Fetch on-chain token holdings
  const { data: holdings, isLoading: holdingsLoading } = useQuery({
    queryKey: ["profile-holdings", address],
    queryFn: async (): Promise<PortfolioHolding[]> => {
      if (!supabase) return [];

      // Scan all storylines with tokens to catch holdings acquired via
      // direct transfers, not just indexed trades
      const { data: storylines } = await supabase
        .from("storylines")
        .select("*")
        .eq("hidden", false)
        .neq("token_address", "")
        .eq("contract_address", STORY_FACTORY.toLowerCase())
        .returns<Storyline[]>();
      if (!storylines || storylines.length === 0) return [];

      // Multicall balanceOf for all storyline tokens
      const balanceResults = await browserClient.multicall({
        contracts: storylines.map((sl) => ({
          address: sl.token_address as Address,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [address as Address],
        })),
        allowFailure: true,
      });

      const held = storylines
        .map((sl, i) => ({ sl, balance: balanceResults[i] }))
        .filter((h) => h.balance.status === "success" && (h.balance.result as bigint) > BigInt(0));
      if (held.length === 0) return [];

      // Fetch prices, 24h change, and TVL for held tokens
      const results = await Promise.all(
        held.map(async ({ sl, balance: balResult }): Promise<PortfolioHolding | null> => {
          const tokenAddr = sl.token_address as Address;
          const balance = balResult.result as bigint;
          try {
            const [price, priceChangeResult, tvlResult] = await Promise.all([
              browserClient.readContract({
                address: MCV2_BOND,
                abi: mcv2BondAbi,
                functionName: "priceForNextMint",
                args: [tokenAddr],
              }),
              get24hPriceChange(tokenAddr, browserClient).catch(() => null),
              getTokenTVL(tokenAddr, browserClient).catch(() => null),
            ]);
            const priceBI = BigInt(price);
            const reserveDecimals = tvlResult?.decimals ?? 18;
            const value = (balance * priceBI) / BigInt(10 ** 18);

            // Derive entry price from first mint in trade_history
            let entryPrice: number | null = null;
            let lastTraded: string | null = null;
            let firstTraded: string | null = null;
            if (supabase) {
              const { data: firstMint } = await supabase
                .from("trade_history")
                .select("price_per_token, block_timestamp")
                .eq("user_address", address)
                .eq("storyline_id", sl.storyline_id)
                .eq("event_type", "mint")
                .eq("contract_address", MCV2_BOND.toLowerCase())
                .order("block_timestamp", { ascending: true })
                .limit(1);
              if (firstMint && firstMint.length > 0) {
                entryPrice = firstMint[0].price_per_token;
              }
              // First trade of any type (mint or transfer-in)
              const { data: firstTrade } = await supabase
                .from("trade_history")
                .select("block_timestamp")
                .eq("user_address", address)
                .eq("storyline_id", sl.storyline_id)
                .eq("contract_address", MCV2_BOND.toLowerCase())
                .order("block_timestamp", { ascending: true })
                .limit(1);
              if (firstTrade && firstTrade.length > 0) {
                firstTraded = firstTrade[0].block_timestamp;
              }
              const { data: lastTrade } = await supabase
                .from("trade_history")
                .select("block_timestamp")
                .eq("user_address", address)
                .eq("storyline_id", sl.storyline_id)
                .eq("contract_address", MCV2_BOND.toLowerCase())
                .order("block_timestamp", { ascending: false })
                .limit(1);
              if (lastTrade && lastTrade.length > 0) {
                lastTraded = lastTrade[0].block_timestamp;
              }
            }

            return {
              storyline: sl, balance, price: priceBI, value,
              entryPrice, lastTraded, firstTraded,
              priceChange: priceChangeResult?.changePercent ?? null,
              reserveDecimals,
            };
          } catch {
            return null;
          }
        }),
      );

      // Sort by most recently traded, then largest value
      return results
        .filter((h): h is PortfolioHolding => h !== null)
        .sort((a, b) => {
          if (a.lastTraded && b.lastTraded) return b.lastTraded.localeCompare(a.lastTraded);
          if (a.lastTraded) return -1;
          if (b.lastTraded) return 1;
          return Number(b.value - a.value);
        });
    },
    staleTime: 60000,
  });

  // Donation history (given as reader) — paginated
  const DONATION_PAGE = 10;
  const {
    data: donationPages,
    isLoading: donGivenLoading,
    isFetchingNextPage: donFetchingNext,
    fetchNextPage: donFetchNext,
    hasNextPage: donHasNext,
  } = useInfiniteQuery({
    queryKey: ["profile-donations-given", address],
    queryFn: async ({ pageParam = 0 }) => {
      if (!supabase) return { rows: [] as Donation[], totalCount: 0 };
      const { data: rows, count } = await supabase
        .from("donations")
        .select("*", { count: "exact" })
        .eq("donor_address", address)
        .eq("contract_address", STORY_FACTORY.toLowerCase())
        .order("block_timestamp", { ascending: false })
        .range(pageParam, pageParam + DONATION_PAGE - 1)
        .returns<Donation[]>();
      return { rows: rows ?? [], totalCount: count ?? 0 };
    },
    initialPageParam: 0,
    getNextPageParam: (_lastPage, allPages) => {
      const totalFetched = allPages.reduce((sum, p) => sum + p.rows.length, 0);
      const totalCount = allPages[0]?.totalCount ?? 0;
      return totalFetched < totalCount ? totalFetched : undefined;
    },
    enabled: isOwnProfile,
  });
  const donationsGiven = donationPages?.pages.flatMap((p) => p.rows) ?? [];
  const donationTotalCount = donationPages?.pages[0]?.totalCount ?? 0;

  // Aggregate donations received as writer
  const { data: donationsReceived, isLoading: donRecvLoading } = useQuery({
    queryKey: ["profile-donations-received-portfolio", address],
    queryFn: async () => {
      if (!supabase) return { total: BigInt(0), count: 0 };
      // Get storylines written by this address
      const { data: writerStorylines } = await supabase
        .from("storylines")
        .select("storyline_id")
        .eq("writer_address", address)
        .eq("hidden", false)
        .eq("contract_address", STORY_FACTORY.toLowerCase());
      if (!writerStorylines || writerStorylines.length === 0) {
        return { total: BigInt(0), count: 0 };
      }
      const sids = writerStorylines.map((s) => s.storyline_id);
      const { data: donations } = await supabase
        .from("donations")
        .select("amount")
        .in("storyline_id", sids)
        .eq("contract_address", STORY_FACTORY.toLowerCase());
      if (!donations || donations.length === 0) return { total: BigInt(0), count: 0 };
      const total = donations.reduce((sum, d) => sum + BigInt(d.amount), BigInt(0));
      return { total, count: donations.length };
    },
  });

  const isLoading = holdingsLoading || donGivenLoading || donRecvLoading;

  if (isLoading) return <p className="text-muted mt-8 text-sm">Loading...</p>;

  const hasHoldings = holdings && holdings.length > 0;
  const hasDonationsGiven = donationsGiven.length > 0;
  const hasDonationsReceived = donationsReceived && donationsReceived.count > 0;

  const totalValue = holdings?.reduce((sum, h) => sum + h.value, BigInt(0)) ?? BigInt(0);
  const reserveDecimals = holdings && holdings.length > 0 ? holdings[0].reserveDecimals : 18;
  const totalDonated = donationsGiven.reduce((sum, d) => sum + BigInt(d.amount), BigInt(0));

  // Compute portfolio-level cost basis % change (only if all holdings have entry prices)
  const portfolioCostPct = (() => {
    if (!holdings || holdings.length === 0 || plotUsd == null) return null;
    if (holdings.some(h => h.entryPrice === null || h.entryPrice <= 0)) return null;
    let totalCurrentUsd = 0;
    let totalCostUsd = 0;
    for (const h of holdings) {
      const currentPrice = Number(formatUnits(h.price, 18));
      const balanceNum = Number(formatUnits(h.balance, 18));
      totalCurrentUsd += currentPrice * balanceNum * plotUsd;
      totalCostUsd += h.entryPrice! * balanceNum * plotUsd;
    }
    if (totalCostUsd === 0) return null;
    return ((totalCurrentUsd - totalCostUsd) / totalCostUsd) * 100;
  })();

  return (
    <div className="mt-6 space-y-4">
      {/* Portfolio summary */}
      {hasHoldings && (
        <>
        <p className="text-muted text-[10px] uppercase tracking-wider">Portfolio</p>
        <div className="border-border rounded border px-4 py-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="border-border rounded border px-2 py-1.5 text-center">
              <div className="text-foreground text-sm font-bold leading-tight">
                {plotUsd ? formatUsdValue(Number(formatUnits(totalValue, reserveDecimals)) * plotUsd) : "—"}
                {portfolioCostPct !== null && (
                  <span className={`ml-1 text-xs font-medium ${portfolioCostPct >= 0 ? "text-accent" : "text-error"}`}>
                    {portfolioCostPct >= 0 ? "+" : ""}{portfolioCostPct.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="text-muted text-[9px]">Value</div>
            </div>
            <div className="border-border rounded border px-2 py-1.5 text-center">
              <div className="text-foreground text-sm font-bold">{holdings!.length}</div>
              <div className="text-muted text-[9px]">Holdings</div>
            </div>
          </div>
        </div>
        </>
      )}

      {/* Token holdings */}
      {hasHoldings && (
        <>
        <p className="text-muted text-[10px] uppercase tracking-wider">Story Token Holdings</p>
        {holdings!.map((h) => (
        <div key={h.storyline.id} className="border-border rounded border text-xs">
          {/* Moleskine book (left) + Info (right) */}
          <div className="flex flex-col sm:flex-row items-center gap-4 px-4 py-3">
            <Link
              href={`/story/${h.storyline.storyline_id}`}
              className="moleskine-notebook group relative block shrink-0 w-[130px] sm:w-[180px]"
            >
              <div
                className="notebook-cover relative z-10 flex flex-col overflow-hidden border border-[var(--border)]"
                style={{
                  aspectRatio: "2/3",
                  borderRadius: "5px 12px 12px 5px",
                  backgroundColor: "#F5EFE6",
                  boxShadow: "2px 4px 8px rgba(44, 24, 16, 0.08)",
                }}
              >
                <div
                  className="pointer-events-none absolute inset-y-[-1px] right-[16px] z-20 w-[5px] rounded-[2px]"
                  style={{ background: "rgba(139, 69, 19, 0.15)" }}
                />
                <div className="relative z-10 px-2.5 pt-2.5">
                  <span className="rounded-sm bg-[var(--accent)]/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-widest text-[var(--accent)]">
                    {h.storyline.genre || "Uncategorized"}
                  </span>
                </div>
                <div className="relative z-10 flex flex-1 items-center justify-center px-3 text-center">
                  <span className="font-heading text-sm sm:text-base font-bold leading-tight text-[var(--accent)]">
                    {h.storyline.title}
                  </span>
                </div>
                <div className="relative z-10 px-2.5 pb-2.5">
                  <span className="text-[8px] text-[var(--text-muted)]">
                    {h.storyline.plot_count} {h.storyline.plot_count === 1 ? "plot" : "plots"}
                  </span>
                </div>
              </div>
            </Link>
            <div className="min-w-0 w-full sm:flex-1">
              <div className="grid grid-cols-2 gap-2">
                {/* Value */}
                <div className="border-border rounded border px-2 py-1.5 text-center">
                  <div className="text-foreground text-sm font-bold leading-tight">
                    {plotUsd ? formatUsdValue(Number(formatUnits(h.value, h.reserveDecimals)) * plotUsd) : "—"}
                    {(() => {
                      if (h.entryPrice == null || h.entryPrice <= 0 || plotUsd == null) return null;
                      const currentPrice = Number(formatUnits(h.price, 18));
                      const costPct = ((currentPrice - h.entryPrice) / h.entryPrice) * 100;
                      return (
                        <span className={`ml-1 text-xs font-medium ${costPct >= 0 ? "text-accent" : "text-error"}`}>
                          {costPct >= 0 ? "+" : ""}{costPct.toFixed(1)}%
                        </span>
                      );
                    })()}
                  </div>
                  <div className="text-muted text-[9px]">Value</div>
                </div>
                {/* Balance */}
                <div className="border-border rounded border px-2 py-1.5 text-center">
                  <div className="text-foreground text-sm font-bold">{formatCompact(Number(formatUnits(h.balance, 18)))}</div>
                  <div className="text-muted text-[9px]">Balance</div>
                </div>
              </div>
              {/* Recent transactions */}
              <HoldingRecentTrades address={address} storylineId={h.storyline.storyline_id} plotUsd={plotUsd} />
            </div>
          </div>
        </div>
      ))}
        </>
      )}

      {/* Donations and Trading History moved to Activity tab */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holding Recent Trades — last 5 transactions for a specific story token
// ---------------------------------------------------------------------------

function HoldingRecentTrades({ address, storylineId, plotUsd }: { address: string; storylineId: number; plotUsd?: number | null }) {
  const { data: trades, isLoading } = useQuery({
    queryKey: ["holding-recent-trades", address, storylineId],
    queryFn: async () => {
      if (!supabase) return [];
      const { data } = await supabase
        .from("trade_history")
        .select("event_type, reserve_amount, block_timestamp, tx_hash")
        .eq("user_address", address)
        .eq("storyline_id", storylineId)
        .eq("contract_address", MCV2_BOND.toLowerCase())
        .order("block_timestamp", { ascending: false })
        .limit(5);
      return data ?? [];
    },
    staleTime: 60000,
  });

  if (isLoading || !trades || trades.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      {trades.map((t, i) => {
        const isBuy = t.event_type === "mint";
        const date = new Date(t.block_timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const amount = plotUsd != null ? formatUsdValue(t.reserve_amount * plotUsd) : `${formatPrice(t.reserve_amount)} ${RESERVE_LABEL}`;
        return (
          <div key={i} className="border-border flex items-center gap-2 rounded border px-3 py-1.5 text-xs">
            <span className={`font-medium shrink-0 w-8 ${isBuy ? "text-green-700" : "text-red-700"}`}>
              {isBuy ? "Buy" : "Sell"}
            </span>
            <span className="text-foreground">{amount}</span>
            {t.tx_hash ? (
              <a
                href={`${EXPLORER_URL}/tx/${t.tx_hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-accent ml-auto whitespace-nowrap text-[10px] transition-colors"
                title="View on Basescan"
              >
                <time dateTime={t.block_timestamp}>{date}</time> &#x2197;
              </a>
            ) : (
              <time dateTime={t.block_timestamp} className="text-muted ml-auto whitespace-nowrap text-[10px]">
                {date}
              </time>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portfolio Trading History — paginated trades
// ---------------------------------------------------------------------------

const TRADE_PAGE_SIZE = 10;

function PortfolioTradingHistory({ address, plotUsd }: { address: string; plotUsd?: number | null }) {
  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ["portfolio-trades", address],
    queryFn: async ({ pageParam = 0 }) => {
      if (!supabase) return { rows: [] as TradeHistory[], totalCount: 0 };
      const { data: rows, count } = await supabase
        .from("trade_history")
        .select("*", { count: "exact" })
        .eq("user_address", address.toLowerCase())
        .order("block_timestamp", { ascending: false })
        .range(pageParam, pageParam + TRADE_PAGE_SIZE - 1)
        .returns<TradeHistory[]>();
      return { rows: rows ?? [], totalCount: count ?? 0 };
    },
    initialPageParam: 0,
    getNextPageParam: (_lastPage, allPages) => {
      const totalFetched = allPages.reduce((sum, p) => sum + p.rows.length, 0);
      const totalCount = allPages[0]?.totalCount ?? 0;
      return totalFetched < totalCount ? totalFetched : undefined;
    },
  });

  const trades = data?.pages.flatMap((p) => p.rows) ?? [];
  const totalCount = data?.pages[0]?.totalCount ?? 0;

  // Fetch storyline titles for displayed trades
  const storylineIds = [...new Set(trades.map((t) => t.storyline_id))];
  const { data: storylineTitles } = useQuery({
    queryKey: ["storyline-titles", storylineIds.join(",")],
    queryFn: async () => {
      if (!supabase || storylineIds.length === 0) return {} as Record<number, string>;
      const { data: rows } = await supabase
        .from("storylines")
        .select("storyline_id, title")
        .in("storyline_id", storylineIds);
      const map: Record<number, string> = {};
      for (const r of rows ?? []) map[r.storyline_id] = r.title;
      return map;
    },
    enabled: storylineIds.length > 0,
  });

  if (isLoading) return <p className="text-muted mt-4 text-sm">Loading trades...</p>;
  if (trades.length === 0) return null;

  return (
    <div className="border-border rounded border text-xs">
      <div className="px-4 py-3">
        <span className="text-muted text-[10px] uppercase tracking-wider">Trades</span>
        <span className="text-foreground ml-2 font-medium">{totalCount} {totalCount === 1 ? "trade" : "trades"}</span>
      </div>

      <div className="border-t border-border divide-y divide-border">
        {trades.map((t) => {
          const isBuy = t.event_type === "mint";
          const title = storylineTitles?.[t.storyline_id];
          const tokenCount = t.price_per_token > 0 ? t.reserve_amount / t.price_per_token : 0;
          return (
            <div key={`${t.tx_hash}-${t.log_index}`} className="px-4 py-2 space-y-0.5">
              {/* Row 1: action + title */}
              <div className="flex items-baseline gap-2">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${isBuy ? "bg-accent/10 text-accent" : "bg-error/10 text-error"}`}>
                  {isBuy ? "Buy" : "Sell"}
                </span>
                <Link
                  href={`/story/${t.storyline_id}`}
                  className="text-foreground hover:text-accent transition-colors"
                >
                  {title || `Story #${t.storyline_id}`}
                </Link>
              </div>
              {/* Row 2: tokens + amount */}
              <div className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                <span className="text-muted">{tokenCount > 0 ? `${formatSupply(tokenCount)} tokens` : ""}</span>
                <span className="text-foreground text-right font-medium">
                  {formatPrice(t.reserve_amount)} {RESERVE_LABEL}
                  {plotUsd && <span className="text-muted font-normal"> ({formatUsdValue(t.reserve_amount * plotUsd)})</span>}
                </span>
              </div>
              {/* Row 3: date + tx link */}
              <div className="text-muted flex items-center gap-1 text-xs">
                {t.block_timestamp && (
                  <time dateTime={t.block_timestamp}>
                    {new Date(t.block_timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </time>
                )}
                {t.tx_hash && (
                  <a href={`${EXPLORER_URL}/tx/${t.tx_hash}`} target="_blank" rel="noopener noreferrer" className="hover:text-accent ml-auto">&#x2197;</a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasNextPage && (
        <div className="border-t border-border px-4 py-2">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="text-accent hover:text-foreground w-full text-center text-xs transition-colors disabled:opacity-50"
          >
            {isFetchingNextPage ? "Loading..." : `Load more (${totalCount - trades.length} remaining)`}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity Tab — unified reverse-chronological feed
// ---------------------------------------------------------------------------

interface FeedEntry {
  type: "created_storyline" | "published_plot" | "bought" | "sold" | "donated" | "rated" | "claimed_royalties";
  timestamp: string;
  storylineId: number;
  storyTitle?: string;
  txHash?: string;
  detail?: string;
  /** Numeric PLOT amount for USD conversion */
  reserveAmount?: number;
}

const FEED_PAGE_SIZE = 30;

function ActivityTab({ address }: { address: string }) {
  const { data: plotUsd } = usePlotUsdPrice();
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE);

  const { data: feed = [], isLoading } = useQuery({
    queryKey: ["profile-activity-feed", address],
    queryFn: async (): Promise<FeedEntry[]> => {
      if (!supabase) return [];

      const PER_SOURCE_LIMIT = 200;

      // Fetch all event sources in parallel (bounded per source)
      const [storylinesRes, plotsRes, tradesRes, donationsRes, ratingsRes] = await Promise.all([
        // Storylines created by this address
        supabase
          .from("storylines")
          .select("storyline_id, title, block_timestamp, tx_hash")
          .eq("writer_address", address)
          .eq("hidden", false)
          .eq("contract_address", STORY_FACTORY.toLowerCase())
          .order("block_timestamp", { ascending: false })
          .limit(PER_SOURCE_LIMIT),
        // Plots published by this address
        supabase
          .from("plots")
          .select("storyline_id, plot_index, title, block_timestamp, tx_hash")
          .eq("writer_address", address)
          .eq("hidden", false)
          .eq("contract_address", STORY_FACTORY.toLowerCase())
          .order("block_timestamp", { ascending: false })
          .limit(PER_SOURCE_LIMIT),
        // Trades by this address (trade_history uses MCV2_BOND as contract_address)
        supabase
          .from("trade_history")
          .select("storyline_id, event_type, reserve_amount, price_per_token, block_timestamp, tx_hash")
          .eq("user_address", address)
          .eq("contract_address", MCV2_BOND.toLowerCase())
          .order("block_timestamp", { ascending: false })
          .limit(PER_SOURCE_LIMIT),
        // Donations by this address
        supabase
          .from("donations")
          .select("storyline_id, amount, block_timestamp, tx_hash")
          .eq("donor_address", address)
          .eq("contract_address", STORY_FACTORY.toLowerCase())
          .order("block_timestamp", { ascending: false })
          .limit(PER_SOURCE_LIMIT),
        // Ratings by this address
        supabase
          .from("ratings")
          .select("storyline_id, rating, created_at")
          .eq("rater_address", address)
          .eq("contract_address", STORY_FACTORY.toLowerCase())
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE_LIMIT),
      ]);

      const entries: FeedEntry[] = [];

      // Created storylines
      for (const s of (storylinesRes.data ?? []) as { storyline_id: number; title: string; block_timestamp: string | null; tx_hash: string }[]) {
        if (!s.block_timestamp) continue;
        entries.push({
          type: "created_storyline",
          timestamp: s.block_timestamp,
          storylineId: s.storyline_id,
          storyTitle: s.title,
          txHash: s.tx_hash,
        });
      }

      // Published plots (skip genesis plot_index=0, already covered by created_storyline)
      for (const p of (plotsRes.data ?? []) as { storyline_id: number; plot_index: number; title: string; block_timestamp: string | null; tx_hash: string }[]) {
        if (!p.block_timestamp || p.plot_index === 0) continue;
        entries.push({
          type: "published_plot",
          timestamp: p.block_timestamp,
          storylineId: p.storyline_id,
          detail: p.title || `Chapter ${p.plot_index}`,
          txHash: p.tx_hash,
        });
      }

      // Trades
      for (const t of (tradesRes.data ?? []) as { storyline_id: number; event_type: string; reserve_amount: number; price_per_token: number; block_timestamp: string; tx_hash: string }[]) {
        const tokenAmount = t.price_per_token > 0
          ? formatPrice(t.reserve_amount / t.price_per_token)
          : null;
        entries.push({
          type: t.event_type === "mint" ? "bought" : "sold",
          timestamp: t.block_timestamp,
          storylineId: t.storyline_id,
          detail: tokenAmount
            ? `${tokenAmount} tokens for ${formatPrice(t.reserve_amount)} ${RESERVE_LABEL}`
            : `${formatPrice(t.reserve_amount)} ${RESERVE_LABEL}`,
          reserveAmount: t.reserve_amount,
          txHash: t.tx_hash,
        });
      }

      // Donations
      for (const d of (donationsRes.data ?? []) as { storyline_id: number; amount: string; block_timestamp: string | null; tx_hash: string }[]) {
        if (!d.block_timestamp) continue;
        entries.push({
          type: "donated",
          timestamp: d.block_timestamp,
          storylineId: d.storyline_id,
          detail: `${formatPrice(formatUnits(BigInt(d.amount), 18))} ${RESERVE_LABEL}`,
          reserveAmount: Number(formatUnits(BigInt(d.amount), 18)),
          txHash: d.tx_hash,
        });
      }

      // Ratings
      for (const r of (ratingsRes.data ?? []) as { storyline_id: number; rating: number; created_at: string }[]) {
        entries.push({
          type: "rated",
          timestamp: r.created_at,
          storylineId: r.storyline_id,
          detail: `${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}`,
        });
      }

      // TODO: Claimed royalties feed entries require a dedicated claim event
      // indexer. For now, cumulative claimed amount is shown in the profile header
      // via on-chain getRoyaltyInfo.

      // Sort reverse-chronological
      entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return entries;
    },
  });

  if (isLoading) return <p className="text-muted mt-8 text-sm">Loading...</p>;
  if (feed.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted text-sm">No activity yet.</p>
        <p className="text-muted mt-1 text-xs">
          This address has no on-chain activity on PlotLink.
        </p>
      </div>
    );
  }

  // Activity Stats
  const tradeEntries = feed.filter((e) => e.type === "bought" || e.type === "sold");
  const donationEntries = feed.filter((e) => e.type === "donated");
  const totalTradeAmount = tradeEntries.reduce((sum, e) => sum + (e.reserveAmount ?? 0), 0);
  const totalDonationAmount = donationEntries.reduce((sum, e) => sum + (e.reserveAmount ?? 0), 0);

  const visible = feed.slice(0, visibleCount);
  const hasMore = visibleCount < feed.length;

  return (
    <div className="mt-6 space-y-4">
      {/* Activity Stats dashboard */}
      <p className="text-muted text-[10px] uppercase tracking-wider">Activity Stats</p>
      <div className="border-border rounded border px-4 py-3 text-xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="border-border rounded border px-2 py-1.5 text-center">
            <div className="text-foreground text-sm font-bold">{tradeEntries.length}</div>
            <div className="text-muted text-[9px]">Trades</div>
          </div>
          <div className="border-border rounded border px-2 py-1.5 text-center">
            <div className="text-foreground text-sm font-bold">{totalTradeAmount > 0 && plotUsd != null ? formatUsdValue(totalTradeAmount * plotUsd) : "—"}</div>
            <div className="text-muted text-[9px]">Trade Vol</div>
          </div>
          <div className="border-border rounded border px-2 py-1.5 text-center">
            <div className="text-foreground text-sm font-bold">{donationEntries.length}</div>
            <div className="text-muted text-[9px]">Donations</div>
          </div>
          <div className="border-border rounded border px-2 py-1.5 text-center">
            <div className="text-foreground text-sm font-bold">{totalDonationAmount > 0 && plotUsd != null ? formatUsdValue(totalDonationAmount * plotUsd) : "—"}</div>
            <div className="text-muted text-[9px]">Donated</div>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        {visible.map((entry, i) => (
          <FeedRow key={`${entry.type}-${entry.timestamp}-${i}`} entry={entry} plotUsd={plotUsd} />
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => setVisibleCount((c) => c + FEED_PAGE_SIZE)}
          className="text-accent hover:text-foreground mt-4 w-full text-center text-xs transition-colors"
        >
          Load more ({feed.length - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}

const EVENT_LABELS: Record<FeedEntry["type"], string> = {
  created_storyline: "Created",
  published_plot: "Published",
  bought: "Bought",
  sold: "Sold",
  donated: "Donated",
  rated: "Rated",
  claimed_royalties: "Claimed",
};

const EVENT_COLORS: Record<FeedEntry["type"], string> = {
  created_storyline: "text-accent",
  published_plot: "text-accent",
  bought: "text-green-700",
  sold: "text-red-700",
  donated: "text-accent",
  rated: "text-muted",
  claimed_royalties: "text-green-700",
};

function FeedRow({ entry, plotUsd }: { entry: FeedEntry; plotUsd?: number | null }) {
  return (
    <div className="border-border flex flex-col gap-1 rounded border px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-2">
      {/* Row 1 (mobile) / Left (desktop): event type + story title */}
      <div className="flex items-center gap-2 min-w-0">
        <span className={`font-medium shrink-0 w-16 ${EVENT_COLORS[entry.type]}`}>
          {EVENT_LABELS[entry.type]}
        </span>
        {entry.storylineId > 0 ? (
          <Link
            href={`/story/${entry.storylineId}`}
            className="text-foreground hover:text-accent truncate transition-colors"
          >
            {entry.storyTitle ?? `Story #${entry.storylineId}`}
          </Link>
        ) : (
          <span className="text-foreground truncate">Royalties</span>
        )}
      </div>
      {/* Row 2 (mobile) / Right (desktop): detail + date + tx link */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-18 sm:shrink-0 sm:pl-0">
        {entry.detail && (
          <span className="text-muted">
            {entry.detail}
            {entry.reserveAmount != null && plotUsd != null && ` (≈ ${formatUsdValue(entry.reserveAmount * plotUsd)})`}
          </span>
        )}
        <time dateTime={entry.timestamp} className="text-muted whitespace-nowrap text-[10px]">
          {new Date(entry.timestamp).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </time>
        {entry.txHash && (
          <a
            href={`${EXPLORER_URL}/tx/${entry.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-accent transition-colors"
            title="View on Basescan"
          >
            &#x2197;
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatViewCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}
