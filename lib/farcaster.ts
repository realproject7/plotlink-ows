/**
 * Farcaster identity lookup — Steemhunt primary, Neynar fallback.
 *
 * Steemhunt's Farcaster Indexer (https://fc.hunt.town) is free and requires
 * no API key. Neynar is used as a fallback only when NEYNAR_API_KEY is set.
 *
 * Simple in-memory cache with 1h TTL, 3s request timeout.
 */

export interface FarcasterProfile {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string | null;
  bio: string | null;
}

const STEEMHUNT_BASE = "https://fc.hunt.town";
const NEYNAR_BASE = "https://api.neynar.com/v2/farcaster";
const REQUEST_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 3600_000; // 1 hour

const cache = new Map<string, { profile: FarcasterProfile | null; expiresAt: number }>();
const inFlight = new Map<string, Promise<FarcasterProfile | null>>();

// Sentinel: API responded successfully but wallet is not linked to Farcaster
const NOT_FOUND = Symbol("NOT_FOUND");
type LookupResult = FarcasterProfile | typeof NOT_FOUND | null; // null = transient error

async function steemhuntLookup(address: string): Promise<LookupResult> {
  const res = await fetch(`${STEEMHUNT_BASE}/users/byWallet/${address}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 404) return NOT_FOUND; // confirmed not linked
  if (!res.ok) return null; // transient error
  const data = await res.json();
  if (!data || !data.fid) return NOT_FOUND;
  return {
    fid: data.fid,
    username: data.username,
    displayName: data.displayName ?? data.username,
    pfpUrl: data.pfpUrl ?? null,
    bio: data.bio ?? data.profile?.bio?.text ?? null,
  };
}

async function neynarLookup(address: string): Promise<LookupResult> {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return null;
  const res = await fetch(
    `${NEYNAR_BASE}/user/bulk-by-address?addresses=${address}`,
    {
      headers: { accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!res.ok) return null; // transient error
  const json = await res.json();
  const users = json[address];
  if (!Array.isArray(users) || users.length === 0) return NOT_FOUND;
  const user = users[0];
  return {
    fid: user.fid,
    username: user.username,
    displayName: user.display_name ?? user.username,
    pfpUrl: user.pfp_url ?? null,
    bio: user.profile?.bio?.text ?? null,
  };
}

/**
 * Look up a Farcaster profile by Ethereum address.
 * Returns `null` when no Farcaster account is linked or both APIs are unavailable.
 */
export async function lookupByAddress(
  address: string,
): Promise<FarcasterProfile | null> {
  const key = address.toLowerCase();

  // Check cache
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;
  if (cached) cache.delete(key);

  // Deduplicate in-flight requests
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      // Steemhunt first (free, no key needed)
      const steemhunt = await steemhuntLookup(key).catch(() => null);
      if (steemhunt && steemhunt !== NOT_FOUND) {
        cache.set(key, { profile: steemhunt, expiresAt: Date.now() + CACHE_TTL_MS });
        return steemhunt;
      }

      // If Steemhunt confirmed "not linked", skip Neynar and cache null
      if (steemhunt === NOT_FOUND) {
        cache.set(key, { profile: null, expiresAt: Date.now() + CACHE_TTL_MS });
        return null;
      }

      // Steemhunt had a transient error — try Neynar fallback
      const neynar = await neynarLookup(key).catch(() => null);
      if (neynar && neynar !== NOT_FOUND) {
        cache.set(key, { profile: neynar, expiresAt: Date.now() + CACHE_TTL_MS });
        return neynar;
      }
      // Only cache null if Neynar confirmed not found; skip cache on transient errors
      if (neynar === NOT_FOUND) {
        cache.set(key, { profile: null, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}
