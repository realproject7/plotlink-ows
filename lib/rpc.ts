import { createPublicClient, http, fallback, type Hex, type PublicClient } from "viem";
import { base, baseSepolia } from "viem/chains";

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "84532");
const chain = chainId === 8453 ? base : baseSepolia;
const IS_MAINNET = chainId === 8453;

const CUSTOM_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;

// ---------------------------------------------------------------------------
// RPC endpoint lists (Base mainnet only — Sepolia uses chain default)
// ---------------------------------------------------------------------------

/** Server-side RPC endpoints ordered by reliability. */
const PUBLIC_RPC_ENDPOINTS = [
  "https://base-rpc.publicnode.com",
  "https://mainnet.base.org",
  "https://base.drpc.org",
  "https://base.llamarpc.com",
  "https://base.meowrpc.com",
  "https://base-mainnet.public.blastapi.io",
  "https://1rpc.io/base",
  "https://base.gateway.tenderly.co",
  "https://rpc.notadegen.com/base",
  "https://base.blockpi.network/v1/rpc/public",
  "https://developer-access-mainnet.base.org",
  "https://base.api.onfinality.io/public",
];

export const RPC_ENDPOINTS = CUSTOM_RPC_URL
  ? [CUSTOM_RPC_URL, ...PUBLIC_RPC_ENDPOINTS]
  : PUBLIC_RPC_ENDPOINTS;

/** Client-side CORS-enabled RPC endpoints for wagmi/browser. */
const PUBLIC_CORS_ENDPOINTS = [
  "https://base-rpc.publicnode.com",
  "https://mainnet.base.org",
  "https://base.drpc.org",
  "https://base.llamarpc.com",
  "https://base.meowrpc.com",
  "https://base-mainnet.public.blastapi.io",
  "https://1rpc.io/base",
  "https://base.gateway.tenderly.co",
  "https://rpc.notadegen.com/base",
  "https://base.blockpi.network/v1/rpc/public",
  "https://developer-access-mainnet.base.org",
  "https://base.api.onfinality.io/public",
];

export const CORS_RPC_ENDPOINTS = CUSTOM_RPC_URL
  ? [CUSTOM_RPC_URL, ...PUBLIC_CORS_ENDPOINTS]
  : PUBLIC_CORS_ENDPOINTS;

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

function buildServerTransport() {
  if (!IS_MAINNET) {
    return CUSTOM_RPC_URL ? fallback([http(CUSTOM_RPC_URL), http()]) : http();
  }
  return fallback(
    RPC_ENDPOINTS.map((url) => http(url, { timeout: 2_000, retryCount: 0, batch: true })),
    { rank: false },
  );
}

// ---------------------------------------------------------------------------
// Public client
// ---------------------------------------------------------------------------

/**
 * Shared public client for reading from Base (or Base Sepolia).
 * On mainnet, uses fallback across multiple RPC endpoints.
 */
export const publicClient = createPublicClient({
  chain,
  transport: buildServerTransport(),
});

/**
 * Browser-safe public client with CORS fallback transport.
 * Use in client components ("use client") instead of publicClient.
 */
export const browserClient = createPublicClient({
  chain,
  transport: IS_MAINNET
    ? fallback(
        CORS_RPC_ENDPOINTS.map((url) =>
          http(url, {
            timeout: 2_000,
            retryCount: 0,
            batch: true,
            fetchOptions: { mode: "cors", credentials: "omit" },
          }),
        ),
        { rank: false },
      )
    : CUSTOM_RPC_URL
      ? fallback([http(CUSTOM_RPC_URL), http()])
      : http(),
});

// ---------------------------------------------------------------------------
// Exports for wagmi
// ---------------------------------------------------------------------------

/**
 * Create a CORS-safe fallback transport for wagmi browser config.
 * On testnet, returns a single http() transport.
 */
export function createFallbackTransport() {
  if (!IS_MAINNET) {
    return CUSTOM_RPC_URL ? fallback([http(CUSTOM_RPC_URL), http()]) : http();
  }
  return fallback(
    CORS_RPC_ENDPOINTS.map((url) =>
      http(url, {
        timeout: 2_000,
        retryCount: 0,
        batch: true,
        fetchOptions: { mode: "cors", credentials: "omit" },
      }),
    ),
    { rank: false },
  );
}

// ---------------------------------------------------------------------------
// Server-side fallback helper
// ---------------------------------------------------------------------------

function getRpcDisplayName(url: string): string {
  if (CUSTOM_RPC_URL && url === CUSTOM_RPC_URL) return "Custom RPC";
  if (url.includes("publicnode.com")) return "PublicNode";
  if (url.includes("mainnet.base.org")) return "Base Official";
  if (url.includes("drpc.org")) return "DRPC";
  if (url.includes("llamarpc.com")) return "LlamaRPC";
  if (url.includes("meowrpc.com")) return "MeowRPC";
  if (url.includes("1rpc.io")) return "1RPC";
  if (url.includes("blastapi.io")) return "BlastAPI";
  if (url.includes("tenderly.co")) return "Tenderly";
  if (url.includes("notadegen.com")) return "NotADegen";
  if (url.includes("blockpi.network")) return "BlockPI";
  if (url.includes("developer-access")) return "Base Dev";
  if (url.includes("onfinality.io")) return "OnFinality";
  return "RPC";
}

/**
 * Try an RPC operation against each endpoint until one succeeds.
 * Use in server-side API routes for operations that need explicit
 * per-endpoint fallback with logging.
 */
export async function withServerRpcFallback<T>(
  operation: (client: PublicClient) => Promise<T>,
  label?: string,
): Promise<T> {
  const endpoints = RPC_ENDPOINTS;
  let lastError: Error | null = null;
  const prefix = label ? `[RPC:${label}]` : "[RPC]";

  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    const name = getRpcDisplayName(url);
    try {
      const client = createPublicClient({
        chain,
        transport: http(url, { timeout: 2_000, retryCount: 0 }),
      }) as PublicClient;
      const result = await operation(client);
      if (i > 0) console.log(`${prefix} Success with ${name} (attempt ${i + 1})`);
      return result;
    } catch (error) {
      lastError = error as Error;
      console.warn(`${prefix} ${name} failed: ${(lastError.message || "").slice(0, 100)}`);
      if (i < endpoints.length - 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  console.error(`${prefix} All ${endpoints.length} RPC endpoints failed`);
  throw lastError || new Error("All RPC endpoints failed");
}

// ---------------------------------------------------------------------------
// Receipt helper
// ---------------------------------------------------------------------------

/**
 * Fetch a transaction receipt with retries and backoff.
 * Uses the fallback-aware publicClient internally.
 */
export async function getReceiptWithRetry(hash: Hex, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await publicClient.getTransactionReceipt({ hash });
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error("unreachable");
}
