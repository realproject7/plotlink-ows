"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Client hook to get PLOT USD price from the API route.
 * Caches for 2 minutes, auto-refetches every 2 minutes.
 */
export function usePlotUsdPrice() {
  return useQuery({
    queryKey: ["plot-usd-price"],
    queryFn: async () => {
      const res = await fetch("/api/tokens/plot-price");
      if (!res.ok) return null;
      const data = await res.json();
      return data.price as number | null;
    },
    staleTime: 2 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
    retry: 2,
  });
}
