/**
 * [#563] X (Twitter) profile stats fetcher via twitterapi.io
 * Based on ~/Projects/dropcast/lib/twitterapi.ts
 */

export interface XStats {
  followers: number;
  following: number;
  isVerified: boolean;
  displayName: string;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function fetchXStats(
  username: string,
): Promise<XStats | null> {
  const apiKey = process.env.TWITTERAPI_IO_KEY;
  if (!apiKey) return null;

  const normalized = username.trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return null;

  try {
    const res = await fetch(
      `https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(normalized)}`,
      {
        headers: { "X-API-Key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!res.ok) return null;

    const json = await res.json();
    const data = json.data;
    if (!data) return null;

    const followers =
      toNum(data.followers) ??
      toNum(data.followersCount) ??
      toNum(data.followers_count);
    const following =
      toNum(data.following) ??
      toNum(data.followingCount) ??
      toNum(data.friends_count);

    if (followers === null || following === null) return null;

    return {
      followers,
      following,
      isVerified:
        !!data.isBlueVerified ||
        !!data.is_blue_verified ||
        !!data.verified,
      displayName:
        data.name || data.displayName || data.display_name || "",
    };
  } catch {
    return null;
  }
}
