"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface PublishIntentData {
  txHash: string | null;
  content: string;
  metadata: Record<string, string>;
  indexerRoute: string;
  uploadKeyPrefix: string;
  createdAt: number;
  retryCount: number;
  lastError: string | null;
}

const STORAGE_KEY = "plotlink_publish_intent_v1";
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_RETRY_ATTEMPTS = 5;

function readIntent(): PublishIntentData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PublishIntentData;
  } catch {
    return null;
  }
}

function writeIntent(intent: PublishIntentData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // localStorage full or unavailable
  }
}

function removeIntent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // silent
  }
}

function loadPendingIntent(): PublishIntentData | null {
  const intent = readIntent();
  if (!intent) return null;

  // Discard stale intents without a tx hash
  if (!intent.txHash && Date.now() - intent.createdAt > STALE_THRESHOLD_MS) {
    removeIntent();
    return null;
  }

  // Pending = has txHash but indexer never succeeded
  return intent.txHash ? intent : null;
}

export function usePublishIntent() {
  const [pendingIntent, setPendingIntent] = useState<PublishIntentData | null>(
    loadPendingIntent,
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const saveIntent = useCallback(
    (opts: {
      content: string;
      metadata: Record<string, string>;
      indexerRoute: string;
      uploadKeyPrefix: string;
    }): void => {
      const intent: PublishIntentData = {
        txHash: null,
        content: opts.content,
        metadata: opts.metadata,
        indexerRoute: opts.indexerRoute,
        uploadKeyPrefix: opts.uploadKeyPrefix,
        createdAt: Date.now(),
        retryCount: 0,
        lastError: null,
      };
      writeIntent(intent);
    },
    [],
  );

  const persistTxHash = useCallback((hash: string): void => {
    const intent = readIntent();
    if (!intent) return;
    const updated = { ...intent, txHash: hash };
    writeIntent(updated);
    // Don't setPendingIntent here — avoids recovery UI flash during active session
  }, []);

  const clearIntent = useCallback((): void => {
    removeIntent();
    if (mountedRef.current) setPendingIntent(null);
  }, []);

  const attemptRetry = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    const intent = readIntent();
    if (!intent?.txHash) {
      return { success: false, error: "No pending transaction found" };
    }

    try {
      const response = await fetch(intent.indexerRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: intent.txHash,
          content: intent.content,
          ...intent.metadata,
        }),
      });

      // 409 = already indexed, treat as success
      if (response.ok || response.status === 409) {
        removeIntent();
        // Don't setPendingIntent(null) here — let RecoveryBanner show
        // the success state before unmounting
        return { success: true };
      }

      const errorMessage = `Indexer error (${response.status})`;
      const updated: PublishIntentData = {
        ...intent,
        retryCount: intent.retryCount + 1,
        lastError: errorMessage,
      };
      writeIntent(updated);
      if (mountedRef.current) setPendingIntent(updated);
      return { success: false, error: errorMessage };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Network error";
      const updated: PublishIntentData = {
        ...intent,
        retryCount: intent.retryCount + 1,
        lastError: errorMessage,
      };
      writeIntent(updated);
      if (mountedRef.current) setPendingIntent(updated);
      return { success: false, error: errorMessage };
    }
  }, []);

  return {
    pendingIntent,
    saveIntent,
    persistTxHash,
    clearIntent,
    attemptRetry,
  };
}
