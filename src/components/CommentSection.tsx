"use client";

import { useState, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConnectWallet } from "./ConnectWallet";
import { FarcasterAvatar } from "./FarcasterAvatar";

interface Comment {
  id: number;
  storyline_id: number;
  plot_index: number;
  commenter_address: string;
  content: string;
  created_at: string;
}

interface CommentsResponse {
  comments: Comment[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 20;

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function CommentSection({
  storylineId,
  plotIndex,
}: {
  storylineId: number;
  plotIndex: number;
}) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();

  const [pages, setPages] = useState(1);
  const [extraComments, setExtraComments] = useState<Comment[]>([]);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data, isLoading } = useQuery<CommentsResponse>({
    queryKey: ["comments", storylineId, plotIndex],
    queryFn: async () => {
      const res = await fetch(
        `/api/comments?storylineId=${storylineId}&plotIndex=${plotIndex}&page=1&limit=${PAGE_SIZE}`,
      );
      if (!res.ok) throw new Error("Failed to load comments");
      return res.json();
    },
    staleTime: 30000,
  });

  const firstPageComments = data?.comments ?? [];
  const total = data?.total ?? 0;
  const allComments = [...firstPageComments, ...extraComments];
  const hasMore = pages * PAGE_SIZE < total;

  const loadMore = useCallback(async () => {
    const nextPage = pages + 1;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/comments?storylineId=${storylineId}&plotIndex=${plotIndex}&page=${nextPage}&limit=${PAGE_SIZE}`,
      );
      if (!res.ok) throw new Error("Failed to load comments");
      const resp: CommentsResponse = await res.json();
      setExtraComments((prev) => [...prev, ...resp.comments]);
      setPages(nextPage);
    } finally {
      setLoadingMore(false);
    }
  }, [pages, storylineId, plotIndex]);

  const handleSubmit = useCallback(async () => {
    if (!address || !content.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const trimmed = content.trim();
      const message = `Comment on storyline ${storylineId} plot ${plotIndex}: ${trimmed}`;
      const signature = await signMessageAsync({ message });

      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storylineId,
          plotIndex,
          content: trimmed,
          address,
          signature,
          message,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error ${res.status}`);
      }

      setContent("");
      setExtraComments([]);
      setPages(1);
      queryClient.invalidateQueries({ queryKey: ["comments", storylineId, plotIndex] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  }, [address, content, storylineId, plotIndex, signMessageAsync, queryClient]);

  return (
    <section className="border-border mt-8 border-t pt-6">
      <h3 className="text-foreground mb-4 text-sm font-semibold">
        Comments {total > 0 && <span className="text-muted font-normal">({total})</span>}
      </h3>

      {/* Comment input */}
      {isConnected ? (
        <div className="mb-6">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, 1000))}
            disabled={submitting}
            rows={3}
            placeholder="Write a comment..."
            className="border-border bg-surface text-foreground placeholder:text-muted w-full resize-y rounded border px-3 py-2 text-sm leading-relaxed focus:border-accent focus:outline-none disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-muted text-xs">{content.length} / 1,000 chars</span>
            <button
              onClick={handleSubmit}
              disabled={submitting || !content.trim()}
              className="border-accent text-accent hover:bg-accent hover:text-background rounded border px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {submitting ? "Signing..." : "Post Comment"}
            </button>
          </div>
          {error && (
            <p className="text-error mt-2 text-xs">{error}</p>
          )}
        </div>
      ) : (
        <div className="mb-6 flex items-center gap-3">
          <span className="text-muted text-xs">Connect wallet to comment</span>
          <ConnectWallet />
        </div>
      )}

      {/* Comment list */}
      {isLoading && allComments.length === 0 && (
        <p className="text-muted text-xs">Loading comments...</p>
      )}

      {!isLoading && allComments.length === 0 && (
        <p className="text-muted text-xs">No comments yet. Be the first!</p>
      )}

      <div className="space-y-4">
        {allComments.map((c) => (
          <div key={c.id} className="text-sm">
            <div className="flex items-baseline gap-2">
              <span className="text-foreground text-xs font-medium">
                <FarcasterAvatar address={c.commenter_address} size={12} />
              </span>
              <span className="text-muted text-[10px]">
                {relativeTime(c.created_at)}
              </span>
            </div>
            <p className="text-foreground mt-0.5 text-xs leading-relaxed">
              {c.content}
            </p>
          </div>
        ))}
      </div>

      {/* Show more */}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="text-muted hover:text-accent mt-4 text-xs transition-colors disabled:opacity-50"
        >
          {loadingMore ? "Loading..." : "Show more comments"}
        </button>
      )}
    </section>
  );
}
