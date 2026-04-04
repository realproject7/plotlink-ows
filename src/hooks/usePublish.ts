"use client";

import { useState, useCallback, useRef } from "react";
import { useWriteContract } from "wagmi";
import { hashContent } from "../../lib/content";
import { browserClient as publicClient } from "../../lib/rpc";
import { indexFetch } from "../../lib/index-fetch";
import type { Hex, Abi, TransactionReceipt } from "viem";

export type PublishState =
  | "idle"
  | "uploading"
  | "confirming"
  | "pending"
  | "indexing"
  | "published"
  | "error";

interface WriteCall {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  gas?: bigint;
  value?: bigint;
}

interface PublishOptions {
  content: string;
  uploadKeyPrefix: string;
  indexerRoute: string;
  buildWriteCall: (cid: string, contentHash: Hex) => WriteCall;
  metadata?: Record<string, string>;
  /** Called before wallet confirmation to save intent */
  onIntentSave?: (opts: {
    content: string;
    metadata: Record<string, string>;
    indexerRoute: string;
    uploadKeyPrefix: string;
  }) => void;
  /** Called after tx confirms to persist tx hash */
  onTxConfirmed?: (hash: string) => void;
  /** Called after successful indexing to clear intent */
  onIndexed?: () => void;
}

/**
 * Shared publishing state machine for StoryFactory write flows.
 *
 * Manages the 5-state flow: uploading -> confirming -> pending -> indexing -> published.
 * Caches CID keyed by content hash for retry (skips re-upload if content unchanged).
 */
export function usePublish() {
  const [state, setState] = useState<PublishState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | undefined>(undefined);
  const [receipt, setReceipt] = useState<TransactionReceipt | undefined>(undefined);
  const cachedCid = useRef<{ cid: string; contentHash: string } | null>(null);

  const { writeContractAsync } = useWriteContract();

  const execute = useCallback(
    async (opts: PublishOptions) => {
      try {
        setError(null);
        const contentHash = hashContent(opts.content);

        // 1. Upload to IPFS (reuse cached CID only if content unchanged)
        let cid: string;
        if (
          cachedCid.current &&
          cachedCid.current.contentHash === contentHash
        ) {
          cid = cachedCid.current.cid;
        } else {
          setState("uploading");
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: opts.content,
              key: `${opts.uploadKeyPrefix}/${Date.now()}.txt`,
            }),
          });
          if (!res.ok) throw new Error("IPFS upload failed");
          const data = await res.json();
          cid = data.cid as string;
          cachedCid.current = { cid, contentHash };
        }

        // 2. Submit tx to wallet
        setState("confirming");
        const writeCall = opts.buildWriteCall(cid, contentHash);

        const hash = await writeContractAsync(writeCall);
        setTxHash(hash);

        // Save intent + tx hash only after wallet signs (not before).
        // This avoids false recovery intents when the wallet rejects —
        // no intent exists if writeContractAsync throws.
        opts.onIntentSave?.({
          content: opts.content,
          metadata: opts.metadata ?? {},
          indexerRoute: opts.indexerRoute,
          uploadKeyPrefix: opts.uploadKeyPrefix,
        });
        opts.onTxConfirmed?.(hash);

        // 3. Wait for tx confirmation
        setState("pending");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        setReceipt(receipt);

        // 4. Trigger indexer
        setState("indexing");
        const indexerRes = await indexFetch(opts.indexerRoute, { txHash: hash, content: opts.content, ...opts.metadata });

        // Only clear intent on success (2xx) or 409 (already indexed)
        if (indexerRes.ok || indexerRes.status === 409) {
          opts.onIndexed?.();
        } else {
          throw new Error(`Indexer error (${indexerRes.status})`);
        }

        // 5. Done
        setState("published");
        cachedCid.current = null;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setState("error");
      }
    },
    [writeContractAsync],
  );

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setTxHash(undefined);
    setReceipt(undefined);
    cachedCid.current = null;
  }, []);

  return { state, error, txHash, receipt, execute, reset };
}
