/**
 * [#563] Enhanced Steemhunt Farcaster Indexer Client
 *
 * Primary data source for user profiles (FREE, no API key required).
 * Based on ~/Projects/dropcast/lib/farcaster-indexer.ts with:
 * - Circuit breaker (5 failures → open 1 min)
 * - Retry with exponential backoff (3 attempts, 3s timeout each)
 * - 1-hour in-memory cache with 5-min DB cooldown
 * - In-flight deduplication
 *
 * Data source: https://fc.hunt.town
 */

// ============================================================================
// Types
// ============================================================================

export interface SteemhuntUser {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  addresses: string[];
  primaryAddress: string;
  proSubscribed: boolean;
  bio: string | null;
  url: string | null;
  location: string | null;
  twitter: string | null;
  github: string | null;
  followersCount: number;
  followingCount: number;
  spamLabel: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Configuration
// ============================================================================

const STEEMHUNT_BASE_URL = "https://fc.hunt.town";
const CACHE_TTL_MS = 3_600_000; // 1 hour
const RETRY_CONFIG = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 2000,
  perAttemptTimeoutMs: 3000,
};
const CIRCUIT_BREAKER = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
};

// Circuit breaker state
let circuitState: "closed" | "open" | "half_open" = "closed";
let consecutiveFailures = 0;
let circuitOpenedAt = 0;
let halfOpenProbeInFlight = false;

// Cache and deduplication
const cache = new Map<
  string,
  { user: SteemhuntUser | null; expiresAt: number }
>();
const inFlightWallet = new Map<string, Promise<SteemhuntUser | null>>();
const inFlightFid = new Map<number, Promise<SteemhuntUser | null>>();

// ============================================================================
// Circuit Breaker
// ============================================================================

function isCircuitOpen(): boolean {
  if (circuitState === "closed") return false;
  if (circuitState === "half_open") return true;

  if (
    circuitState === "open" &&
    Date.now() - circuitOpenedAt >= CIRCUIT_BREAKER.resetTimeoutMs
  ) {
    if (!halfOpenProbeInFlight) {
      halfOpenProbeInFlight = true;
      circuitState = "half_open";
      return false;
    }
    return true;
  }
  return true;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitState = "closed";
  halfOpenProbeInFlight = false;
}

function recordFailure(): void {
  if (circuitState === "half_open") {
    circuitState = "open";
    circuitOpenedAt = Date.now();
    halfOpenProbeInFlight = false;
    return;
  }
  consecutiveFailures++;
  if (
    consecutiveFailures >= CIRCUIT_BREAKER.failureThreshold &&
    circuitState === "closed"
  ) {
    circuitState = "open";
    circuitOpenedAt = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Fetch with retry
// ============================================================================

async function fetchWithRetry(
  url: string,
): Promise<SteemhuntUser | null> {
  if (isCircuitOpen()) return null;

  let lastStatus: number | null = null;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(RETRY_CONFIG.perAttemptTimeoutMs),
      });

      if (res.ok) {
        const data: SteemhuntUser = await res.json();
        recordSuccess();
        return data;
      }

      if (res.status === 404) {
        recordSuccess();
        return null;
      }

      // Retryable status codes
      if (res.status === 429 || res.status >= 500) {
        lastStatus = res.status;
        if (attempt < RETRY_CONFIG.maxRetries) {
          const delay = Math.min(
            RETRY_CONFIG.initialDelayMs * Math.pow(2, attempt),
            RETRY_CONFIG.maxDelayMs,
          );
          await sleep(delay);
        }
        continue;
      }

      // Non-retryable client error
      recordSuccess();
      return null;
    } catch {
      if (attempt < RETRY_CONFIG.maxRetries) {
        const delay = Math.min(
          RETRY_CONFIG.initialDelayMs * Math.pow(2, attempt),
          RETRY_CONFIG.maxDelayMs,
        );
        await sleep(delay);
      }
    }
  }

  recordFailure();
  if (lastStatus) {
    console.error(`[Steemhunt] Fetch failed: ${lastStatus} (retries exhausted)`);
  }
  return null;
}

// ============================================================================
// Public API
// ============================================================================

export async function getUserByWallet(
  address: string,
): Promise<SteemhuntUser | null> {
  const key = address.toLowerCase();

  const cached = cache.get(`wallet:${key}`);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const existing = inFlightWallet.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const user = await fetchWithRetry(
        `${STEEMHUNT_BASE_URL}/users/byWallet/${key}`,
      );
      cache.set(`wallet:${key}`, {
        user,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return user;
    } finally {
      inFlightWallet.delete(key);
    }
  })();

  inFlightWallet.set(key, promise);
  return promise;
}

export async function getUserByFid(
  fid: number,
): Promise<SteemhuntUser | null> {
  const cached = cache.get(`fid:${fid}`);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const existing = inFlightFid.get(fid);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const user = await fetchWithRetry(
        `${STEEMHUNT_BASE_URL}/users/byFid/${fid}`,
      );
      cache.set(`fid:${fid}`, {
        user,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return user;
    } finally {
      inFlightFid.delete(fid);
    }
  })();

  inFlightFid.set(fid, promise);
  return promise;
}
