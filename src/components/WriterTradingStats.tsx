"use client";

import { useQuery } from "@tanstack/react-query";
import { formatUnits, type Address } from "viem";
import { browserClient } from "../../lib/rpc";
import { mcv2BondAbi, getTokenTVL } from "../../lib/price";
import { MCV2_BOND, RESERVE_LABEL } from "../../lib/contracts/constants";
import { formatPrice } from "../../lib/format";
import { formatUsdValue } from "../../lib/usd-price";
import type { Storyline } from "../../lib/supabase";

interface WriterTradingStatsProps {
  storyline: Storyline;
  plotUsd?: number | null;
  showPrice?: boolean;
}

export function WriterTradingStats({ storyline, plotUsd, showPrice = true }: WriterTradingStatsProps) {
  const tokenAddress = storyline.token_address as Address;

  // Fetch price + TVL together so they succeed/fail atomically
  const { data } = useQuery({
    queryKey: ["writer-stats", tokenAddress],
    queryFn: async () => {
      const [priceRaw, tvlData] = await Promise.all([
        browserClient.readContract({
          address: MCV2_BOND,
          abi: mcv2BondAbi,
          functionName: "priceForNextMint",
          args: [tokenAddress],
        }),
        getTokenTVL(tokenAddress, browserClient),
      ]);
      const decimals = tvlData?.decimals ?? 18;
      return {
        price: formatUnits(BigInt(priceRaw), decimals),
        tvl: tvlData?.tvl ?? formatUnits(BigInt(0), decimals),
        decimals,
      };
    },
    enabled: !!tokenAddress,
    retry: 2,
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-1 text-xs">
      {showPrice && (
        <div>
          <span className="text-muted">Price:</span>{" "}
          <span className="text-foreground font-medium">{data ? `${formatPrice(data.price)} ${RESERVE_LABEL}` : "—"}</span>
          {data && plotUsd && <span className="text-muted"> ({formatUsdValue(parseFloat(data.price) * plotUsd)})</span>}
        </div>
      )}
      <div>
        <span className="text-muted">TVL:</span>{" "}
        <span className="text-foreground font-medium">{data ? `${formatPrice(data.tvl)} ${RESERVE_LABEL}` : "—"}</span>
        {data && plotUsd && <span className="text-muted"> ({formatUsdValue(parseFloat(data.tvl) * plotUsd)})</span>}
      </div>
    </div>
  );
}
