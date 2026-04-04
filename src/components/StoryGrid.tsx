"use client";

import { type Address } from "viem";
import { type Storyline } from "../../lib/supabase";
import { BatchTokenDataProvider } from "./BatchTokenDataProvider";
import { StoryCard } from "./StoryCard";

/**
 * Story card grid wrapped in BatchTokenDataProvider.
 * Fetches price + TVL for all visible stories in a single multicall
 * instead of 4 individual RPC calls per card.
 *
 * Plain responsive grid — 2 columns on mobile, 3 on desktop.
 */
export function StoryGrid({ storylines }: { storylines: Storyline[] }) {
  const tokenAddresses = storylines
    .map((s) => s.token_address)
    .filter((addr): addr is string => !!addr) as Address[];

  return (
    <BatchTokenDataProvider tokenAddresses={tokenAddresses}>
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-3">
        {storylines.map((s) => (
          <StoryCard key={s.id} storyline={s} />
        ))}
      </div>
    </BatchTokenDataProvider>
  );
}
