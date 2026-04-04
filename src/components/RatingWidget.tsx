"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { browserClient as publicClient } from "../../lib/rpc";
import { erc20Abi } from "../../lib/price";
import type { Address } from "viem";
import { StarDisplay, StarInput } from "./StarRating";
import { FarcasterAvatar } from "./FarcasterAvatar";

interface RatingData {
  id: number;
  storyline_id: number;
  rater_address: string;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

interface RatingsResponse {
  ratings: RatingData[];
  average: number;
  count: number;
  myRating: RatingData | null;
}

interface RatingWidgetProps {
  storylineId: number;
  tokenAddress: string;
}

export function RatingWidget({ storylineId, tokenAddress }: RatingWidgetProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Fetch ratings
  const { data: ratingsData, refetch } = useQuery<RatingsResponse>({
    queryKey: ["ratings", storylineId, address],
    queryFn: async () => {
      const params = new URLSearchParams({ storylineId: String(storylineId) });
      if (address) params.set("raterAddress", address);
      const res = await fetch(`/api/ratings?${params}`);
      if (!res.ok) throw new Error("Failed to fetch ratings");
      return res.json();
    },
  });

  // Check token balance
  const { data: hasTokens } = useQuery({
    queryKey: ["tokenBalance", tokenAddress, address],
    queryFn: async () => {
      if (!address) return false;
      const balance = await publicClient.readContract({
        address: tokenAddress as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });
      return balance > BigInt(0);
    },
    enabled: isConnected && !!address,
  });

  // Pre-fill existing rating or reset when wallet changes
  useEffect(() => {
    if (ratingsData && address) {
      const existing = ratingsData.myRating;
      if (existing) {
        setSelectedRating(existing.rating);
        setComment(existing.comment ?? "");
      } else {
        setSelectedRating(0);
        setComment("");
      }
    } else if (!address) {
      setSelectedRating(0);
      setComment("");
    }
  }, [ratingsData, address]);

  const submitRating = useCallback(async () => {
    if (!address || selectedRating === 0) return;

    try {
      setError(null);
      setSuccess(false);
      setSubmitting(true);

      const message = `Rate storyline ${storylineId} with rating ${selectedRating} comment:${comment || ""}`;
      const signature = await signMessageAsync({ message });

      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storylineId,
          rating: selectedRating,
          comment: comment || undefined,
          address,
          signature,
          message,
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to submit rating");
      }

      setSuccess(true);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }, [address, selectedRating, comment, storylineId, signMessageAsync, refetch]);

  const ratings = ratingsData?.ratings ?? [];
  const average = ratingsData?.average ?? 0;
  const count = ratingsData?.count ?? 0;

  return (
    <section className="border-border mt-8 rounded border px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-foreground text-sm font-medium">Ratings</h2>
        {count > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <StarDisplay rating={average} size={18} />
            <span className="text-muted">
              {average.toFixed(1)} ({count})
            </span>
          </div>
        )}
      </div>

      {/* Rating form or gate message */}
      {isConnected && hasTokens ? (
        <div className="mt-3">
          <label className="text-muted block text-[10px] uppercase tracking-wider">
            Your rating
          </label>
          <div className="mt-1">
            <StarInput
              value={selectedRating}
              onChange={setSelectedRating}
              disabled={submitting}
            />
          </div>

          <textarea
            placeholder="Comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={submitting}
            maxLength={500}
            rows={2}
            className="border-border bg-background text-foreground mt-2 w-full resize-none rounded border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
          />

          <button
            onClick={submitRating}
            disabled={selectedRating === 0 || submitting}
            className="bg-accent text-background mt-2 w-full rounded py-2 text-xs font-medium transition-opacity disabled:opacity-40"
          >
            {submitting ? "Signing..." : success ? "Updated!" : "Submit Rating"}
          </button>

          {error && <p className="mt-2 text-xs text-error">{error}</p>}
        </div>
      ) : isConnected ? (
        <p className="text-muted mt-3 text-xs">
          Hold storyline tokens to rate this story.
        </p>
      ) : null}

      {/* Recent ratings */}
      {ratings.length > 0 && (
        <div className="border-border mt-4 border-t pt-3">
          <h3 className="text-muted text-[10px] uppercase tracking-wider">
            Recent Ratings
          </h3>
          <div className="mt-2 space-y-2">
            {ratings.slice(0, 10).map((r) => (
              <div key={r.id} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-foreground">
                    <FarcasterAvatar address={r.rater_address} size={12} />
                  </span>
                  <StarDisplay rating={r.rating} size={12} />
                </div>
                {r.comment && (
                  <p className="text-muted mt-0.5 pl-0.5">{r.comment}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
