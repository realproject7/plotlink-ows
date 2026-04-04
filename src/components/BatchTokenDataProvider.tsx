"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Address } from "viem";
import { getBatchTokenData, type BatchTokenEntry } from "../../lib/price";
import { browserClient } from "../../lib/rpc";

type BatchTokenDataMap = Map<string, BatchTokenEntry>;

interface BatchTokenDataContextValue {
  data: BatchTokenDataMap;
  isReady: boolean;
}

const BatchTokenDataContext = createContext<BatchTokenDataContextValue>({
  data: new Map(),
  isReady: false,
});

export function useBatchTokenData(tokenAddress: string): {
  entry: BatchTokenEntry | undefined;
  isReady: boolean;
} {
  const { data, isReady } = useContext(BatchTokenDataContext);
  return { entry: data.get(tokenAddress.toLowerCase()), isReady };
}

/**
 * Fetches price + TVL for all provided token addresses in a single
 * multicall RPC request and provides the data via context.
 */
export function BatchTokenDataProvider({
  tokenAddresses,
  children,
}: {
  tokenAddresses: Address[];
  children: ReactNode;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["batch-token-data", tokenAddresses.join(",")],
    queryFn: () => getBatchTokenData(tokenAddresses, browserClient),
    staleTime: 60000,
    enabled: tokenAddresses.length > 0,
  });

  return (
    <BatchTokenDataContext.Provider value={{ data: data ?? new Map(), isReady: !isLoading }}>
      {children}
    </BatchTokenDataContext.Provider>
  );
}
