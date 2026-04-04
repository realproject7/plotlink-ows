/**
 * Detect whether we are running inside a Farcaster Mini App context.
 * Safe to call on server (returns false) and outside Farcaster (returns false).
 */
export async function isFarcasterMiniApp(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { sdk } = await import("@farcaster/miniapp-sdk");
    const ctx = await sdk.context;
    return !!ctx;
  } catch {
    return false;
  }
}
