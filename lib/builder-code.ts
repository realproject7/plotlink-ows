/**
 * Base Builder Code (ERC-8021) attribution for PlotLink transactions.
 *
 * Appends a Builder Code suffix to transaction calldata so Base indexers
 * can attribute onchain activity back to PlotLink.
 *
 * Register at base.dev and set NEXT_PUBLIC_BUILDER_CODE in env vars.
 */

import { Attribution } from "ox/erc8021";

const BUILDER_CODE = process.env.NEXT_PUBLIC_BUILDER_CODE ?? "";

/**
 * Pre-computed ERC-8021 data suffix for the configured Builder Code.
 * Returns undefined if Builder Code is not configured (attribution disabled).
 */
export const DATA_SUFFIX: `0x${string}` | undefined = BUILDER_CODE
  ? Attribution.toDataSuffix({ codes: [BUILDER_CODE] })
  : undefined;
