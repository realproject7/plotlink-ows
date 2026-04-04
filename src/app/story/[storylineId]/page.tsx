import { type Metadata } from "next";
import { Suspense } from "react";
import { createServerClient, type Storyline, type Plot } from "../../../../lib/supabase";
import { DeadlineCountdown } from "../../../components/DeadlineCountdown";
import { AddPlotButton } from "../../../components/AddPlotButton";
import { TradingWidget } from "../../../components/TradingWidget";
import { PriceChart } from "../../../components/PriceChart";
import { DonateWidget } from "../../../components/DonateWidget";
import { RatingWidget } from "../../../components/RatingWidget";
import { RatingSummary } from "../../../components/RatingSummary";
import { ShareButtons } from "../../../components/ShareButtons";
import { StoryContent } from "../../../components/StoryContent";
import { ReadingModeWrapper } from "../../../components/ReadingModeWrapper";
import { getTokenPrice, type TokenPriceInfo } from "../../../../lib/price";
import { RESERVE_LABEL, STORY_FACTORY } from "../../../../lib/contracts/constants";
import { formatPrice, formatSupply } from "../../../../lib/format";
import { type Address } from "viem";
import { truncateAddress } from "../../../../lib/utils";
import Link from "next/link";
import { AgentBadge } from "../../../components/AgentBadge";
import { WriterIdentity } from "../../../components/WriterIdentity";
import { ViewCount, ViewTracker } from "../../../components/ViewCount";
import { CommentSection } from "../../../components/CommentSection";
import { MobileActionBar } from "../../../components/MobileActionBar";
import { MarketCapBox } from "../../../components/MarketCapBox";

/** Deduplicate plots by plot_index, keeping the first occurrence. */
function deduplicateByPlotIndex(plots: Plot[]) {
  const seen = new Set<number>();
  return plots
    .filter((p) => {
      if (seen.has(p.plot_index)) return false;
      seen.add(p.plot_index);
      return true;
    })
    .map((p) => ({
      plotIndex: p.plot_index,
      title: p.title || (p.plot_index === 0 ? "Genesis" : `Chapter ${p.plot_index}`),
      content: p.content,
    }));
}

type Params = Promise<{ storylineId: string }>;

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { storylineId } = await params;
  const id = Number(storylineId);

  if (isNaN(id) || id <= 0) return {};

  const supabase = createServerClient();
  if (!supabase) return {};

  const { data: storyline } = await supabase
    .from("storylines")
    .select("*")
    .eq("storyline_id", id)
    .eq("hidden", false)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .single();

  if (!storyline) return {};

  const sl = storyline as Storyline;
  const ogImageUrl = `${appUrl}/story/${id}/og`;
  const storyUrl = `${appUrl}/story/${id}`;

  const priceInfo = sl.token_address
    ? await getTokenPrice(sl.token_address as Address)
    : null;
  const reserveLabel = RESERVE_LABEL;
  const priceSuffix = priceInfo
    ? ` — Price: ${formatPrice(priceInfo.pricePerToken)} ${reserveLabel}`
    : "";
  const description = `An on-chain story by ${truncateAddress(sl.writer_address)} — ${sl.plot_count} ${sl.plot_count === 1 ? "plot" : "plots"}${priceSuffix}`;

  const fcEmbed = JSON.stringify({
    version: "1",
    imageUrl: ogImageUrl,
    button: {
      title: "Read Story",
      action: {
        type: "launch_miniapp",
        url: storyUrl,
        name: "PlotLink",
        splashBackgroundColor: "#E8DFD0",
      },
    },
  });

  return {
    title: `${sl.title} — PlotLink`,
    description,
    openGraph: {
      title: sl.title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: sl.title,
      description,
      images: [ogImageUrl],
    },
    other: {
      "fc:miniapp": fcEmbed,
    },
  };
}

export default async function StoryPage({ params }: { params: Params }) {
  const { storylineId } = await params;
  const id = Number(storylineId);

  if (isNaN(id) || id <= 0) {
    return <NotFound message="Invalid storyline ID" />;
  }

  const supabase = createServerClient();
  if (!supabase) {
    return <NotFound message="Database unavailable" />;
  }

  const { data: storyline } = await supabase
    .from("storylines")
    .select("*")
    .eq("storyline_id", id)
    .eq("hidden", false)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .single();

  if (!storyline) {
    return <NotFound message="Storyline not found" />;
  }

  const { data: plotRows } = await supabase
    .from("plots")
    .select("*")
    .eq("storyline_id", id)
    .eq("hidden", false)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .order("plot_index", { ascending: true })
    .returns<Plot[]>();

  const plots = plotRows ?? [];
  const genesis = plots.find((p) => p.plot_index === 0) ?? null;
  const chapters = plots.filter((p) => p.plot_index > 0);

  const sl = storyline as Storyline;
  const priceInfo = sl.token_address
    ? await getTokenPrice(sl.token_address as Address)
    : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 pb-24 lg:pb-10">
      <ViewTracker storylineId={id} />
      <StoryHeader storyline={storyline} priceInfo={priceInfo} />

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_320px]">
        {/* Story content — genesis + table of contents */}
        <main className="min-w-0">
          {genesis ? (
            <>
              <GenesisSection
                plot={genesis}
                readingMode={
                  <ReadingModeWrapper
                    storylineId={id}
                    storylineTitle={sl.title}
                    chapters={deduplicateByPlotIndex(plots)}
                    initialPlotIndex={0}
                  />
                }
              />
              {chapters.length > 0 && (
                <a
                  href={`/story/${id}/1`}
                  className="border-accent text-accent hover:bg-accent/10 mt-8 block w-full rounded border py-3 text-center text-sm font-medium transition-colors"
                >
                  Read the first Plot
                </a>
              )}
              <CommentSection storylineId={id} plotIndex={0} />
            </>
          ) : (
            <p className="text-muted text-sm">No plots yet.</p>
          )}

          {chapters.length > 0 && (
            <TableOfContents
              storylineId={id}
              chapters={chapters}
            />
          )}

          {/* Share buttons — below chapters */}
          <div className="mt-6">
            <ShareButtons storylineId={id} title={sl.title} />
          </div>
        </main>

        {/* Sidebar — desktop only */}
        <aside className="hidden space-y-4 lg:block">
          {sl.token_address && priceInfo && (
            <PriceChart
              tokenAddress={sl.token_address as Address}
              currentPriceRaw={priceInfo.priceRaw}
            />
          )}
          {sl.token_address && (
            <TradingWidget tokenAddress={sl.token_address as Address} />
          )}
          <DonateWidget storylineId={id} writerAddress={sl.writer_address} />
          {sl.token_address && (
            <RatingWidget storylineId={id} tokenAddress={sl.token_address} />
          )}
        </aside>
      </div>

      {/* Mobile floating bottom bar */}
      <MobileActionBar
        tradeContent={
          sl.token_address ? (
            <>
              {priceInfo && (
                <PriceChart
                  tokenAddress={sl.token_address as Address}
                  currentPriceRaw={priceInfo.priceRaw}
                />
              )}
              <TradingWidget tokenAddress={sl.token_address as Address} />
            </>
          ) : undefined
        }
        donateContent={
          <DonateWidget storylineId={id} writerAddress={sl.writer_address} />
        }
        rateContent={
          sl.token_address ? (
            <RatingWidget storylineId={id} tokenAddress={sl.token_address} />
          ) : undefined
        }
      />
    </div>
  );
}

function StoryHeader({
  storyline,
  priceInfo,
}: {
  storyline: Storyline;
  priceInfo: TokenPriceInfo | null;
}) {
  const createdDate = storyline.block_timestamp
    ? new Date(storyline.block_timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  const statsGrid = priceInfo ? (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      <div className="border-border rounded border px-2 py-1.5 text-center min-w-0">
        <MarketCapBox
          tokenAddress={storyline.token_address}
          totalSupply={parseFloat(priceInfo.totalSupply)}
          pricePerToken={parseFloat(priceInfo.pricePerToken)}
        />
      </div>
      <div className="border-border rounded border px-2 py-1.5 text-center min-w-0">
        <div className="text-foreground text-sm font-bold">{formatSupply(priceInfo.totalSupply)}</div>
        <div className="text-muted text-[9px]">Supply Minted</div>
      </div>
      <div className="border-border rounded border px-2 py-1.5 text-center min-w-0">
        {storyline.sunset ? (
          <>
            <div className="text-foreground text-sm font-bold">{storyline.plot_count}</div>
            <div className="text-muted text-[9px]">Complete</div>
          </>
        ) : storyline.has_deadline && storyline.last_plot_time ? (
          <>
            <div className="text-foreground text-sm font-bold leading-tight">
              <DeadlineCountdown lastPlotTime={storyline.last_plot_time} hideLabel valueClassName="text-foreground text-sm font-bold" />
            </div>
            <div className="text-muted text-[9px]">Deadline</div>
          </>
        ) : (
          <>
            <div className="text-foreground text-sm font-bold">—</div>
            <div className="text-muted text-[9px]">Deadline</div>
          </>
        )}
      </div>
      <div className="border-border rounded border px-2 py-1.5 text-center min-w-0">
        <div className="text-foreground text-sm font-bold">{formatPrice(priceInfo.pricePerToken)} {RESERVE_LABEL}</div>
        <div className="text-muted text-[9px]">Token Price</div>
      </div>
      <div className="border-border rounded border px-2 py-1.5 text-center min-w-0">
        <div className="text-foreground text-sm font-bold">{storyline.plot_count}</div>
        <div className="text-muted text-[9px]">{storyline.plot_count === 1 ? "Plot" : "Plots"}</div>
      </div>
      <div className="border-border rounded border px-2 py-1.5 text-center min-w-0">
        <div className="text-foreground text-sm font-bold">{createdDate ?? "—"}</div>
        <div className="text-muted text-[9px]">Created</div>
      </div>
    </div>
  ) : null;

  const ctaButton = (
    <AddPlotButton storylineId={storyline.storyline_id} writerAddress={storyline.writer_address} lastPlotTime={storyline.last_plot_time} sunset={storyline.sunset} hasDeadline={storyline.has_deadline} />
  );

  return (
    <header
      className="pb-6 grid gap-x-4 sm:gap-x-6 grid-cols-[130px_1fr] sm:grid-cols-[160px_1fr] [grid-template-areas:'cover_info'_'stats_stats'] sm:[grid-template-areas:'cover_info'_'._stats']"
    >
      {/* Moleskine book cover */}
      <div className="[grid-area:cover]">
        <div
          className="relative flex flex-col overflow-hidden border border-[var(--border)]"
          style={{
            aspectRatio: "2/3",
            borderRadius: "5px 12px 12px 5px",
            backgroundColor: "#F5EFE6",
            boxShadow: "2px 4px 8px rgba(44, 24, 16, 0.08)",
          }}
        >
          <div
            className="pointer-events-none absolute inset-y-[-1px] right-[16px] z-20 w-[5px] rounded-[2px]"
            style={{ background: "rgba(139, 69, 19, 0.15)" }}
          />
          <div className="relative z-10 px-2.5 pt-2.5">
            <span className="rounded-sm bg-[var(--accent)]/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-widest text-[var(--accent)]">
              {storyline.genre || "Uncategorized"}
            </span>
          </div>
          <div className="relative z-10 flex flex-1 items-center justify-center px-3 text-center">
            <span className="font-heading text-sm sm:text-base font-bold leading-tight text-[var(--accent)]">
              {storyline.title}
            </span>
          </div>
          <div className="relative z-10 px-2.5 pb-2.5">
            <span className="text-[8px] text-[var(--text-muted)]">
              {storyline.plot_count} {storyline.plot_count === 1 ? "plot" : "plots"}
            </span>
          </div>
        </div>
      </div>

      {/* Info column */}
      <div className="[grid-area:info] min-w-0">
        <h1 className="font-body text-xl sm:text-2xl font-bold tracking-tight text-accent">
          {storyline.title}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <RatingSummary storylineId={storyline.storyline_id} separator />
          <ViewCount storylineId={storyline.storyline_id} initialCount={storyline.view_count} />
        </div>
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted w-12 shrink-0">Writer</span>
            <Suspense fallback={<span className="text-foreground font-medium">{truncateAddress(storyline.writer_address)}</span>}>
              <WriterIdentity address={storyline.writer_address} />
            </Suspense>
            {storyline.writer_type === 1 && <AgentBadge />}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted w-12 shrink-0">Genre</span>
            <span className="text-foreground font-medium">
              {storyline.genre || "Uncategorized"}
              {storyline.language && storyline.language !== "English" && (
                <span className="text-muted ml-1.5">· {storyline.language}</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Stats + CTA — rendered once, repositioned via grid areas */}
      <div className="[grid-area:stats]">
        {statsGrid && <div className="mt-4 sm:mt-6">{statsGrid}</div>}
        <div className="[&_a]:w-full [&_div]:w-full sm:[&_a]:w-auto sm:[&_div]:w-auto">{ctaButton}</div>
      </div>
    </header>
  );
}

function GenesisSection({ plot, readingMode }: { plot: Plot; readingMode?: React.ReactNode }) {
  return (
    <section id="genesis">
      <ViewTracker storylineId={plot.storyline_id} plotIndex={0} />
      <div className="text-muted mb-3 flex items-center gap-3 text-xs">
        <span className="text-accent-dim font-medium">Genesis</span>
        {plot.block_timestamp && (
          <time dateTime={plot.block_timestamp}>
            {new Date(plot.block_timestamp).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </time>
        )}
        {readingMode && <span className="ml-auto">{readingMode}</span>}
      </div>
      {plot.content ? (
        <StoryContent content={plot.content} />
      ) : (
        <p className="text-muted text-sm italic">
          Content unavailable (CID: {plot.content_cid})
        </p>
      )}
    </section>
  );
}

function TableOfContents({
  storylineId,
  chapters,
}: {
  storylineId: number;
  chapters: Plot[];
}) {
  return (
    <section className="mt-10">
      <h2 className="text-foreground mb-4 text-sm font-semibold uppercase tracking-wider">
        Chapters
      </h2>
      <div className="divide-border divide-y">
        {chapters.map((ch) => {
          const chapterTitle = ch.title || `Chapter ${ch.plot_index}`;
          const preview = ch.content ? ch.content.slice(0, 100) : "";
          const dateStr = ch.block_timestamp
            ? new Date(ch.block_timestamp).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })
            : null;

          return (
            <Link
              key={ch.id}
              href={`/story/${storylineId}/${ch.plot_index}`}
              className="hover:bg-surface/50 flex items-start justify-between gap-4 py-3 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-foreground text-sm font-medium">
                  {chapterTitle}
                </div>
                {preview && (
                  <p className="text-muted mt-0.5 truncate text-xs">
                    {preview}
                    {ch.content && ch.content.length > 100 ? "…" : ""}
                  </p>
                )}
              </div>
              <div className="text-muted shrink-0 text-xs">
                {dateStr}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function NotFound({ message }: { message: string }) {
  return (
    <div className="flex min-h-[calc(100vh-2.75rem)] flex-col items-center justify-center px-6">
      <p className="text-muted text-sm">{message}</p>
    </div>
  );
}
