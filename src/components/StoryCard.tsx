import Link from "next/link";
import type { Storyline } from "../../lib/supabase";
import { AgentBadge } from "./AgentBadge";
import { WriterIdentityClient } from "./WriterIdentityClient";
import { RatingSummary } from "./RatingSummary";
import { StoryCardTVL } from "./StoryCardStats";

const DAY_MS = 24 * 60 * 60 * 1000;
function isWithin24h(timestamp: string): boolean {
  return Date.now() - new Date(timestamp).getTime() < DAY_MS;
}

export function StoryCard({
  storyline,
  genre,
}: {
  storyline: Storyline;
  genre?: string;
}) {
  const displayGenre = genre || storyline.genre;
  const isNew = storyline.last_plot_time
    ? isWithin24h(storyline.last_plot_time)
    : false;

  return (
    <div className="flex flex-col">
      <Link
        href={`/story/${storyline.storyline_id}`}
        className="moleskine-notebook group relative block"
      >
        {/* Page underneath — revealed when cover opens */}
        <div
          className="notebook-page absolute inset-0 z-0 overflow-hidden"
          style={{
            borderRadius: "5px 16px 16px 5px",
            backgroundColor: "#FFF8EE",
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0px, transparent 27px, #e8dfd0 27px, #e8dfd0 28px)",
          }}
        >
          <div className="flex h-full flex-col justify-between px-5 py-5">
            <div className="mt-6 space-y-2 text-xs text-[var(--text-muted)]">
              <p className="font-body italic leading-relaxed">
                {storyline.plot_count} {storyline.plot_count === 1 ? "plot" : "plots"} linked
              </p>
              {storyline.token_address && (
                <p className="font-body italic">
                  <StoryCardTVL tokenAddress={storyline.token_address} />
                </p>
              )}
            </div>
            <p className="text-[10px] text-[var(--text-muted)]">Open to read →</p>
          </div>
        </div>

        {/* Cover — opens on hover (desktop) */}
        <div
          className="notebook-cover relative z-10 flex aspect-[2/3] flex-col overflow-hidden border border-[var(--border)]"
          style={{
            borderRadius: "5px 15px 15px 5px",
            backgroundColor: "#F5EFE6",
            boxShadow: "2px 4px 12px rgba(44, 24, 16, 0.1)",
          }}
        >
          {/* Elastic band — seamless, subtle */}
          <div
            className="pointer-events-none absolute inset-y-[-1px] right-[22px] z-20 w-[8px] rounded-[2px]"
            style={{
              background: "rgba(139, 69, 19, 0.18)",
              boxShadow: "1px 0 2px rgba(0,0,0,0.05), -1px 0 2px rgba(0,0,0,0.03)",
            }}
          />

          {/* Top: genre badge */}
          <div className="relative z-10 px-4 pt-4">
            <div className="flex flex-wrap items-start gap-1.5">
              <span className="rounded-sm bg-[var(--accent)]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-[var(--accent)]">
                {displayGenre || "Uncategorized"}
              </span>
              {storyline.sunset && (
                <span className="rounded-sm border border-[var(--border)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">
                  complete
                </span>
              )}
            </div>
          </div>

          {/* Center: title */}
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 text-center">
            <h3 className="font-heading text-lg font-bold leading-tight tracking-tight text-[var(--accent)] sm:text-xl">
              {storyline.title}
            </h3>
            {storyline.language && storyline.language !== "English" && (
              <span className="mt-2 text-[10px] text-[var(--text-muted)]">
                {storyline.language}
              </span>
            )}
          </div>

          {/* Bottom: plot count + NEW badges */}
          <div className="relative z-10 px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-sm border border-[var(--border)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">
                {storyline.plot_count} {storyline.plot_count === 1 ? "plot" : "plots"}
              </span>
              {isNew && (
                <span className="rounded-sm bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9px] font-bold text-[var(--accent)]">
                  NEW
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>

      {/* Metadata below notebook: author → TVL → rating */}
      <div className="mt-2.5 flex flex-col gap-0.5 pl-1 pr-1 text-[10px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1">
          <WriterIdentityClient address={storyline.writer_address} />
          {storyline.writer_type === 1 && <AgentBadge />}
        </span>
        {storyline.token_address && (
          <span className="whitespace-nowrap">
            <StoryCardTVL tokenAddress={storyline.token_address} />
          </span>
        )}
        <RatingSummary storylineId={storyline.storyline_id} />
      </div>
    </div>
  );
}
