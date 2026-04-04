/**
 * [#563] Quotient API Client
 *
 * Fetches Quotient Score (engagement/reputation metric) for Farcaster users.
 * Based on ~/Projects/dropcast/lib/quotient.ts
 *
 * Reference: https://docs.quotient.social/reputation/context
 */

export interface QuotientUserData {
  fid: number;
  username: string;
  quotientScore: number;
  quotientRank: number;
  contextLabels: string[];
}

const QUOTIENT_API_URL = "https://api.quotient.social";

export const QUOTIENT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function fetchQuotientScore(
  fid: number,
): Promise<QuotientUserData | null> {
  const apiKey = process.env.QUOTIENT_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`${QUOTIENT_API_URL}/v1/user-reputation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fids: [fid], api_key: apiKey }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const json = await res.json();
    const data = json.data;
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

export function isQuotientStale(updatedAt: string | null): boolean {
  if (!updatedAt) return true;
  return Date.now() - new Date(updatedAt).getTime() > QUOTIENT_TTL_MS;
}
