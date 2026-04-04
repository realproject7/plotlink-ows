import { keccak256, toHex } from "viem";

/** Minimum content length in Unicode characters. */
export const MIN_CONTENT_LENGTH = 500;

/** Maximum content length in Unicode characters. */
export const MAX_CONTENT_LENGTH = 10_000;

/**
 * Compute keccak256 hash of content, matching the onchain contentHash
 * stored in PlotChained events.
 *
 * Uses UTF-8 encoding — same as `keccak256(toBytes(content))` in viem
 * and `keccak256(abi.encodePacked(content))` in Solidity.
 */
export function hashContent(content: string): `0x${string}` {
  return keccak256(toHex(content));
}

/**
 * Validate content length using Unicode-aware character counting.
 *
 * Uses `[...str].length` (iterator-based) to correctly count characters
 * like Korean syllables and emoji as single characters regardless of
 * their UTF-8 byte length.
 *
 * Range: 500–10,000 characters (proposal §4.1).
 */
export function validateContentLength(content: string): {
  valid: boolean;
  charCount: number;
} {
  const charCount = [...content].length;
  return {
    valid: charCount >= MIN_CONTENT_LENGTH && charCount <= MAX_CONTENT_LENGTH,
    charCount,
  };
}
