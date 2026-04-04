"use client";

import { useQuery } from "@tanstack/react-query";
import { StarDisplay } from "./StarRating";

interface RatingsResponse {
  average: number;
  count: number;
}

export function RatingSummary({
  storylineId,
  separator,
}: {
  storylineId: number;
  separator?: boolean;
}) {
  const { data } = useQuery<RatingsResponse>({
    queryKey: ["ratings", storylineId],
    queryFn: async () => {
      const res = await fetch(`/api/ratings?storylineId=${storylineId}`);
      if (!res.ok) throw new Error("Failed to fetch ratings");
      return res.json();
    },
  });

  if (!data || data.count === 0) return null;

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <StarDisplay rating={data.average} size={14} />
        <span className="text-muted text-xs">
          {data.average.toFixed(1)} ({data.count})
        </span>
      </span>
      {separator && <span className="text-border" aria-hidden="true">·</span>}
    </>
  );
}
