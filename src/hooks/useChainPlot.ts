"use client";

import { useCallback } from "react";
import { usePublish } from "./usePublish";
import { storyFactoryAbi } from "../../lib/contracts/abi";
import { STORY_FACTORY } from "../../lib/contracts/constants";

interface ChainPlotIntentCallbacks {
  onIntentSave?: (opts: {
    content: string;
    metadata: Record<string, string>;
    indexerRoute: string;
    uploadKeyPrefix: string;
  }) => void;
  onTxConfirmed?: (hash: string) => void;
  onIndexed?: () => void;
}

/**
 * Chain a plot to an existing storyline (P3-3).
 * Reuses the shared publishing state machine from usePublish.
 */
export function useChainPlot(intentCallbacks?: ChainPlotIntentCallbacks) {
  const { state, error, txHash, execute, reset } = usePublish();

  const chainPlot = useCallback(
    async (storylineId: number, content: string, title = "") => {
      await execute({
        content,
        uploadKeyPrefix: `plotlink/plots/${storylineId}`,
        indexerRoute: "/api/index/plot",
        buildWriteCall: (cid, contentHash) => ({
          address: STORY_FACTORY,
          abi: storyFactoryAbi as unknown as [],
          functionName: "chainPlot",
          args: [BigInt(storylineId), title, cid, contentHash],
          gas: BigInt(500_000),
        }),
        onIntentSave: intentCallbacks?.onIntentSave,
        onTxConfirmed: intentCallbacks?.onTxConfirmed,
        onIndexed: intentCallbacks?.onIndexed,
      });
    },
    [execute, intentCallbacks],
  );

  return { state, error, txHash, chainPlot, reset };
}
