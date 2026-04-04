/**
 * USD Price for PLOT token (server-side)
 *
 * Fallback chain: Mint Club SDK → GeckoTerminal → CoinGecko → DB cache
 *
 * Only tracks PLOT USD price — storyline token USD values are derived from it:
 *   storyline_token_USD = storyline_token_price_in_PLOT × PLOT_USD_price
 *
 * Reference: ~/Projects/dropcast/lib/usd-price.ts
 */

import { PLOT_TOKEN } from "./contracts/constants";

// In-memory cache
let cachedPrice: number | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// In-flight coalescing
let inflightRequest: Promise<number | null> | null = null;

const PLOT_ADDRESS = PLOT_TOKEN.toLowerCase();

/**
 * Get PLOT token USD price with fallback chain
 */
export async function getPlotUsdPrice(
  forceRefresh = false,
): Promise<number | null> {
  // Return cached price if fresh
  if (!forceRefresh && cachedPrice !== null && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedPrice;
  }

  // Coalesce concurrent requests
  if (inflightRequest && !forceRefresh) {
    return inflightRequest;
  }

  inflightRequest = fetchPlotUsdPrice();
  try {
    const price = await inflightRequest;
    if (price !== null) {
      cachedPrice = price;
      cacheTimestamp = Date.now();
    }
    return price ?? cachedPrice;
  } finally {
    inflightRequest = null;
  }
}

async function fetchPlotUsdPrice(): Promise<number | null> {
  // Source 1: Mint Club SDK (optional dependency — skipped if not installed)
  try {
    const { mintclub } = await import(/* webpackIgnore: true */ "mint.club-v2-sdk" as string) as { mintclub: { network: (n: string) => { token: (a: `0x${string}`) => { getUsdRate: () => Promise<{ usdRate: number }> } } } };
    const token = mintclub.network("base").token(PLOT_TOKEN);
    const { usdRate } = await token.getUsdRate();
    if (usdRate && usdRate > 0) {
      return usdRate;
    }
  } catch {
    console.info(`[USD Price] source=mint_club result=miss token=${PLOT_ADDRESS}`);
  }

  // Source 2: GeckoTerminal (free, no key required)
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/base/tokens/${PLOT_ADDRESS}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json();
      const priceUsd = data?.data?.attributes?.price_usd;
      if (priceUsd) {
        const price = parseFloat(priceUsd);
        if (!isNaN(price) && price > 0) return price;
      }
    }
  } catch {
    console.info(`[USD Price] source=geckoterminal result=miss token=${PLOT_ADDRESS}`);
  }

  // Source 3: CoinGecko
  try {
    const apiKey = process.env.COINGECKO_API_KEY;
    const url = `https://api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=${PLOT_ADDRESS}&vs_currencies=usd`;
    const headers: HeadersInit = { Accept: "application/json" };
    if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json();
      const tokenData = data[PLOT_ADDRESS];
      if (tokenData?.usd && tokenData.usd > 0) return tokenData.usd;
    }
  } catch {
    console.info(`[USD Price] source=coingecko result=miss token=${PLOT_ADDRESS}`);
  }

  console.warn(`[USD Price] All sources exhausted for PLOT token`);
  return null;
}

/**
 * Format a USD value for display
 */
export function formatUsdValue(value: number | null): string {
  if (value === null) return "—";
  if (value < 0.01) return "< $0.01";
  if (value < 1) return `$${value.toFixed(3)}`;
  if (value < 1000) return `$${value.toFixed(2)}`;
  if (value < 1_000_000) return `$${(value / 1000).toFixed(2)}K`;
  return `$${(value / 1_000_000).toFixed(2)}M`;
}
