/**
 * [#489, #521] Farcaster notification system for PlotLink.
 *
 * Handles notification token storage (Supabase) and sending push
 * notifications to Farcaster clients via the miniapp notification API.
 *
 * [#521] Targeted notifications: new plot notifications go only to
 * storyline token holders. Price change alerts (>10%) sent to holders.
 */

import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http, erc20Abi, type Address } from "viem";
import { base } from "viem/chains";
import { STORY_FACTORY } from "./contracts/constants";

const NEYNAR_BASE = "https://api.neynar.com/v2/farcaster";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function getSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getRpcClient() {
  return createPublicClient({
    chain: base,
    transport: http(process.env.NEXT_PUBLIC_RPC_URL),
  });
}

export interface NotificationToken {
  fid: number;
  notificationToken: string;
  notificationUrl: string;
}

// ---- Token Management ----

export async function saveUserNotificationToken(
  fid: number,
  token: string,
  url: string,
  clientAppFid?: number,
): Promise<void> {
  const supabase = getSupabase();

  // Resolve wallet from FID via trusted Neynar API
  const walletAddress = await resolveWalletForFid(fid);

  const row: Record<string, unknown> = {
    fid,
    notification_token: token,
    notification_url: url,
    client_app_fid: clientAppFid || null,
    enabled: true,
    updated_at: new Date().toISOString(),
  };
  if (walletAddress) {
    row.wallet_address = walletAddress;
  }

  const { error } = await supabase
    .from("notification_tokens")
    .upsert(row, { onConflict: "fid" });

  if (error) {
    console.error("Failed to save notification token:", error);
    throw new Error(`Failed to save notification token: ${error.message}`);
  }
}

export async function disableUserNotifications(fid: number): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .from("notification_tokens")
    .update({ enabled: false })
    .eq("fid", fid);

  if (error) {
    console.error("Failed to disable notifications:", error);
  }
}

export async function getEnabledTokens(): Promise<NotificationToken[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("notification_tokens")
    .select("*")
    .eq("enabled", true);

  if (error) {
    console.error("Failed to get notification tokens:", error);
    return [];
  }

  return (data || []).map((row) => ({
    fid: row.fid,
    notificationToken: row.notification_token,
    notificationUrl: row.notification_url,
  }));
}

// ---- [#521] FID → Wallet Resolution (trusted) ----

/**
 * Resolve a Farcaster FID to its verified Ethereum address via Neynar API.
 * Returns the first verified address, or null if unavailable.
 */
async function resolveWalletForFid(fid: number): Promise<string | null> {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`${NEYNAR_BASE}/user/bulk?fids=${fid}`, {
      headers: { accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const user = json.users?.[0];
    if (!user) return null;

    // Use first verified Ethereum address
    const verifiedAddress = user.verified_addresses?.eth_addresses?.[0];
    return verifiedAddress?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// ---- [#521] Token Holder Targeting ----

/**
 * Get notification tokens for users who hold a specific storyline token.
 * Queries enabled tokens with wallet_address, then checks on-chain balanceOf.
 */
async function getTokenHolderTokens(
  tokenAddress: string,
): Promise<NotificationToken[]> {
  const supabase = getSupabase();
  const rpc = getRpcClient();

  // Get all enabled tokens that have a wallet_address
  const { data, error } = await supabase
    .from("notification_tokens")
    .select("*")
    .eq("enabled", true)
    .not("wallet_address", "is", null);

  if (error || !data || data.length === 0) return [];

  // Check on-chain balances via multicall
  const balanceResults = await rpc.multicall({
    contracts: data.map((row) => ({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [row.wallet_address as Address],
    })),
    allowFailure: true,
  });

  // Filter to holders (balance > 0)
  return data
    .filter((_, i) => {
      const result = balanceResults[i];
      return result.status === "success" && (result.result as bigint) > BigInt(0);
    })
    .map((row) => ({
      fid: row.fid,
      notificationToken: row.notification_token,
      notificationUrl: row.notification_url,
    }));
}

// ---- Notification Sending ----

export async function sendNotification(params: {
  notificationId: string;
  title: string;
  body: string;
  targetUrl: string;
  tokens: NotificationToken[];
}): Promise<{ successful: number; failed: number }> {
  const { notificationId, title, body, targetUrl, tokens } = params;
  const supabase = getSupabase();

  if (tokens.length === 0) return { successful: 0, failed: 0 };

  // Group tokens by notification URL
  const tokensByUrl = new Map<string, string[]>();
  for (const t of tokens) {
    if (!tokensByUrl.has(t.notificationUrl)) {
      tokensByUrl.set(t.notificationUrl, []);
    }
    tokensByUrl.get(t.notificationUrl)!.push(t.notificationToken);
  }

  let successful = 0;
  let failed = 0;

  for (const [url, urlTokens] of tokensByUrl.entries()) {
    // Batch up to 100 tokens per request (Farcaster API limit)
    for (let i = 0; i < urlTokens.length; i += 100) {
      const batch = urlTokens.slice(i, i + 100);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notificationId,
            title,
            body,
            targetUrl,
            tokens: batch,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          const invalidBatchTokens =
            result.invalidTokens || result.result?.invalidTokens || [];
          successful += batch.length - invalidBatchTokens.length;

          // Delete invalid tokens
          if (invalidBatchTokens.length > 0) {
            await supabase
              .from("notification_tokens")
              .delete()
              .in("notification_token", invalidBatchTokens);
          }
        } else {
          failed += batch.length;
          console.error(
            `[NOTIFICATION] Failed batch to ${url}: ${response.status}`,
          );
        }
      } catch (error) {
        console.error("Error sending notification batch:", error);
        failed += batch.length;
      }
    }
  }

  return { successful, failed };
}

// ---- PlotLink-Specific Triggers ----

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://plotlink.xyz";

/**
 * Notify all users with enabled notifications about a new storyline.
 * Called from the backfill cron when a new storyline is first indexed.
 */
export async function notifyNewStoryline(
  storylineId: number,
  title: string,
  author: string,
): Promise<void> {
  const tokens = await getEnabledTokens();
  if (tokens.length === 0) return;

  await sendNotification({
    notificationId: `pl-new-storyline-${storylineId}`,
    title: "New story published",
    body: `"${title}" by ${author} is now on PlotLink`,
    targetUrl: `${appUrl}/story/${storylineId}`,
    tokens,
  });
}

/**
 * [#521] Notify token holders about a new plot in a storyline they hold.
 * Falls back to all users if no token address or no holders found.
 */
export async function notifyNewPlot(
  storylineId: number,
  storyTitle: string,
  plotIndex: number,
): Promise<void> {
  const supabase = getSupabase();
  const label = plotIndex === 0 ? "Genesis" : `Chapter ${plotIndex}`;

  // Look up storyline token address
  const { data: storyline } = await supabase
    .from("storylines")
    .select("token_address")
    .eq("storyline_id", storylineId)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .single();

  // Only notify token holders — no broadcast fallback
  if (!storyline?.token_address) return;

  const tokens = await getTokenHolderTokens(storyline.token_address);
  if (tokens.length === 0) return;

  await sendNotification({
    notificationId: `pl-new-plot-${storylineId}-${plotIndex}`,
    title: `New ${label} published`,
    body: `"${storyTitle.slice(0, 40)}" has a new plot on PlotLink`,
    targetUrl: `${appUrl}/story/${storylineId}`,
    tokens,
  });
}

// ---- [#521] Price Change Alerts ----

const PRICE_CHANGE_THRESHOLD = 10; // percent

/**
 * Snapshot current price for a token and check for >10% change.
 * If threshold exceeded, sends alert to all holders of that token.
 */
export async function checkPriceChangeAlert(
  tokenAddress: string,
  currentPrice: number,
  storylineId: number,
  storyTitle: string,
): Promise<boolean> {
  const supabase = getSupabase();

  // Get previous snapshot
  const { data: prev } = await supabase
    .from("token_price_snapshots")
    .select("price")
    .eq("token_address", tokenAddress.toLowerCase())
    .order("snapshot_time", { ascending: false })
    .limit(1)
    .single();

  // Save current snapshot
  await supabase.from("token_price_snapshots").insert({
    token_address: tokenAddress.toLowerCase(),
    price: currentPrice,
  });

  if (!prev || !prev.price) return false;

  const previousPrice = Number(prev.price);
  if (previousPrice === 0) return false;

  const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100;

  if (Math.abs(changePercent) < PRICE_CHANGE_THRESHOLD) return false;

  // Alert holders
  const tokens = await getTokenHolderTokens(tokenAddress);
  if (tokens.length === 0) return false;

  const direction = changePercent > 0 ? "up" : "down";
  const absChange = Math.abs(changePercent).toFixed(1);

  await sendNotification({
    notificationId: `pl-price-alert-${tokenAddress}-${Date.now()}`,
    title: `Price ${direction} ${absChange}%`,
    body: `"${storyTitle.slice(0, 30)}" token moved ${direction} ${absChange}%`,
    targetUrl: `${appUrl}/story/${storylineId}`,
    tokens,
  });

  return true;
}
