"use client";

import { useQuery } from "@tanstack/react-query";
import { type Address } from "viem";
import { getTokenTVL, getTokenPrice } from "../../lib/price";
import { browserClient } from "../../lib/rpc";
import { RESERVE_LABEL } from "../../lib/contracts/constants";
import { useBatchTokenData } from "./BatchTokenDataProvider";
import { usePlotUsdPrice } from "../hooks/usePlotUsdPrice";
import { formatUsdValue } from "../../lib/usd-price";

function formatCompact(value: string): string {
  const num = parseFloat(value);
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  if (num < 1) return num.toPrecision(3);
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toFixed(2);
}


/** Full stats row with price + TVL (used on detail pages) */
export function StoryCardStats({ tokenAddress }: { tokenAddress: string }) {
  const addr = tokenAddress as Address;
  const { data: plotUsd } = usePlotUsdPrice();

  const { data: priceInfo } = useQuery({
    queryKey: ["card-price", tokenAddress],
    queryFn: () => getTokenPrice(addr, browserClient),
    staleTime: 60000,
  });

  const { data: tvlData } = useQuery({
    queryKey: ["card-tvl", tokenAddress],
    queryFn: () => getTokenTVL(addr, browserClient),
    staleTime: 60000,
  });

  const price = priceInfo
    ? formatCompact(priceInfo.pricePerToken)
    : "—";
  const tvl = tvlData
    ? formatCompact(tvlData.tvl)
    : "—";

  const priceUsd = priceInfo && plotUsd
    ? formatUsdValue(parseFloat(priceInfo.pricePerToken) * plotUsd)
    : null;
  const tvlUsd = tvlData && plotUsd
    ? formatUsdValue(parseFloat(tvlData.tvl) * plotUsd)
    : null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
      <span>Price: <span className="font-semibold text-[var(--accent)]">{price} {RESERVE_LABEL}</span>{priceUsd && <span className="ml-1 opacity-60">({priceUsd})</span>}</span>
      <span>TVL: <span className="font-semibold text-[var(--accent)]">{tvl} {RESERVE_LABEL}</span>{tvlUsd && <span className="ml-1 opacity-60">({tvlUsd})</span>}</span>
    </div>
  );
}

/** TVL-only display for home page book cards.
 *  Uses batch context when available (home page), falls back to individual fetch. */
export function StoryCardTVL({ tokenAddress }: { tokenAddress: string }) {
  const { entry: batchEntry, isReady } = useBatchTokenData(tokenAddress);
  const addr = tokenAddress as Address;
  const { data: plotUsd } = usePlotUsdPrice();

  // Only fall back to individual fetch AFTER batch has settled
  const { data: individualTvl } = useQuery({
    queryKey: ["card-tvl", tokenAddress],
    queryFn: () => getTokenTVL(addr, browserClient),
    staleTime: 60000,
    enabled: isReady && !batchEntry,
  });

  const tvlData = batchEntry?.tvl ?? individualTvl;
  const tvl = tvlData ? formatCompact(tvlData.tvl) : "—";
  const tvlUsd = tvlData && plotUsd
    ? formatUsdValue(parseFloat(tvlData.tvl) * plotUsd)
    : null;

  return (
    <span>TVL: <span className="font-semibold text-[var(--accent)]">{tvl} {RESERVE_LABEL}</span>{tvlUsd && <span className="ml-1 opacity-60">({tvlUsd})</span>}</span>
  );
}
