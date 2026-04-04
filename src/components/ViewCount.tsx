"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";

// ---------------------------------------------------------------------------
// SVG eye icon matching the design system
// ---------------------------------------------------------------------------

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Compact number formatting: 1234 → "1.2k", 1000000 → "1M"
// ---------------------------------------------------------------------------

function formatViewCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${Math.round(n / 1000000)}M`;
}

// ---------------------------------------------------------------------------
// ViewCount — displays eye icon + count (fetches from server)
// ---------------------------------------------------------------------------

export function ViewCount({
  storylineId,
  initialCount,
}: {
  storylineId: number;
  initialCount?: number;
}) {
  const { data } = useQuery({
    queryKey: ["view-count", storylineId],
    queryFn: async () => {
      const res = await fetch(`/api/views?storylineId=${storylineId}`);
      if (!res.ok) return initialCount ?? 0;
      const json = await res.json();
      return json.viewCount as number;
    },
    initialData: initialCount,
    staleTime: 120000,
  });

  const count = data ?? initialCount ?? 0;

  return (
    <span className="text-muted inline-flex items-center gap-1 text-xs">
      <EyeIcon className="h-3 w-3" />
      <span>{formatViewCount(count)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ViewTracker — fire-and-forget POST on mount to record a view
// ---------------------------------------------------------------------------

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  const key = "plotlink-session-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

export function ViewTracker({
  storylineId,
  plotIndex,
}: {
  storylineId: number;
  plotIndex?: number | null;
}) {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  useEffect(() => {
    const sessionId = getSessionId();
    if (!sessionId) return;

    fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storylineId,
        plotIndex: plotIndex ?? null,
        sessionId,
        viewerAddress: address ?? null,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && !data.deduplicated) {
          // Invalidate the cached count so it refetches
          queryClient.invalidateQueries({ queryKey: ["view-count", storylineId] });
        }
      })
      .catch(() => {
        // Silently ignore — view tracking is best-effort
      });
  }, [storylineId, plotIndex, address, queryClient]);

  return null;
}
