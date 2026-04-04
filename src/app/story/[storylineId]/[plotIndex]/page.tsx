import { type Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createServerClient, type Storyline, type Plot } from "../../../../../lib/supabase";
import { STORY_FACTORY } from "../../../../../lib/contracts/constants";
import { truncateAddress } from "../../../../../lib/utils";
import { WriterIdentity } from "../../../../components/WriterIdentity";
import { ViewTracker } from "../../../../components/ViewCount";
import { CommentSection } from "../../../../components/CommentSection";
import { StoryContent } from "../../../../components/StoryContent";
import { ReadingModeWrapper } from "../../../../components/ReadingModeWrapper";
import Link from "next/link";

/** Deduplicate plots by plot_index, keeping the first occurrence. */
function deduplicateByPlotIndex(plots: { plot_index: number; title: string; content: string | null }[]) {
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

type Params = Promise<{ storylineId: string; plotIndex: string }>;

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const revalidate = 120;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { storylineId, plotIndex } = await params;
  const sid = Number(storylineId);
  const pidx = Number(plotIndex);

  if (isNaN(sid) || sid <= 0 || isNaN(pidx) || pidx < 0) return {};

  const supabase = createServerClient();
  if (!supabase) return {};

  const [{ data: storyline }, { data: plot }] = await Promise.all([
    supabase.from("storylines").select("*").eq("storyline_id", sid).eq("hidden", false).eq("contract_address", STORY_FACTORY.toLowerCase()).single(),
    supabase.from("plots").select("*").eq("storyline_id", sid).eq("plot_index", pidx).eq("hidden", false).eq("contract_address", STORY_FACTORY.toLowerCase()).single(),
  ]);

  if (!storyline || !plot) return {};

  const sl = storyline as Storyline;
  const p = plot as Plot;
  const chapterTitle = p.title || `Chapter ${pidx}`;
  const preview = p.content ? p.content.slice(0, 160) : "";

  return {
    title: `${chapterTitle} — ${sl.title} — PlotLink`,
    description: preview || `A chapter of ${sl.title} by ${truncateAddress(sl.writer_address)}`,
    openGraph: {
      title: `${chapterTitle} — ${sl.title}`,
      description: preview,
      url: `${appUrl}/story/${sid}/${pidx}`,
    },
  };
}

export default async function PlotDetailPage({ params }: { params: Params }) {
  const { storylineId, plotIndex } = await params;
  const sid = Number(storylineId);
  const pidx = Number(plotIndex);

  if (isNaN(sid) || sid <= 0 || isNaN(pidx) || pidx < 0) {
    return <NotFound message="Invalid plot URL" />;
  }

  // Genesis (plot 0) redirects to the main story page
  if (pidx === 0) {
    redirect(`/story/${sid}`);
  }

  const supabase = createServerClient();
  if (!supabase) return <NotFound message="Database unavailable" />;

  const [{ data: storyline }, { data: plot }, { data: plotRows }] = await Promise.all([
    supabase.from("storylines").select("*").eq("storyline_id", sid).eq("hidden", false).eq("contract_address", STORY_FACTORY.toLowerCase()).single(),
    supabase.from("plots").select("*").eq("storyline_id", sid).eq("plot_index", pidx).eq("hidden", false).eq("contract_address", STORY_FACTORY.toLowerCase()).single(),
    supabase.from("plots").select("plot_index, title, content").eq("storyline_id", sid).eq("hidden", false).eq("contract_address", STORY_FACTORY.toLowerCase()).order("plot_index", { ascending: true }),
  ]);

  if (!storyline) return <NotFound message="Storyline not found" />;
  if (!plot) return <NotFound message="Chapter not found" />;

  const sl = storyline as Storyline;
  const p = plot as Plot;
  const allPlots = (plotRows ?? []) as { plot_index: number; title: string; content: string | null }[];
  const allIndexes = allPlots.map((r) => r.plot_index);
  const currentPos = allIndexes.indexOf(pidx);
  const prevIndex = currentPos > 0 ? allIndexes[currentPos - 1] : null;
  const nextIndex = currentPos < allIndexes.length - 1 ? allIndexes[currentPos + 1] : null;

  const chapterTitle = p.title || (pidx === 0 ? "Genesis" : `Chapter ${pidx}`);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <ViewTracker storylineId={sid} plotIndex={pidx} />

      {/* Breadcrumb */}
      <nav className="text-muted mb-6 text-xs">
        <Link href={`/story/${sid}`} className="hover:text-accent transition-colors">
          {sl.title}
        </Link>
        <span className="mx-2">›</span>
        <span className="text-foreground">{chapterTitle}</span>
      </nav>

      {/* Chapter header with inline reading mode */}
      <header className="border-border mb-8 border-b pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-accent flex-1 text-xl font-bold tracking-tight">
            {chapterTitle}
          </h1>
          <ReadingModeWrapper
            storylineId={sid}
            storylineTitle={sl.title}
            chapters={deduplicateByPlotIndex(allPlots)}
            initialPlotIndex={pidx}
          />
        </div>
        <div className="text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>
            by{" "}
            <Suspense fallback={<span className="text-foreground">{truncateAddress(sl.writer_address)}</span>}>
              <WriterIdentity address={sl.writer_address} />
            </Suspense>
          </span>
          {p.block_timestamp && (
            <time dateTime={p.block_timestamp}>
              {new Date(p.block_timestamp).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
          )}
        </div>
      </header>

      {/* Plot content */}
      {p.content ? (
        <StoryContent content={p.content} />
      ) : (
        <p className="text-muted text-sm italic">
          Content unavailable (CID: {p.content_cid})
        </p>
      )}

      {/* Comments */}
      <CommentSection storylineId={sid} plotIndex={pidx} />

      {/* Navigation */}
      <nav className="border-border mt-10 flex items-center justify-between border-t pt-6">
        {prevIndex !== null ? (
          <Link
            href={`/story/${sid}/${prevIndex}`}
            className="border-border text-muted hover:text-foreground rounded border px-4 py-2 text-xs transition-colors"
          >
            &larr; Previous
          </Link>
        ) : (
          <span />
        )}
        <Link
          href={`/story/${sid}`}
          className="text-muted hover:text-accent text-xs transition-colors"
        >
          Table of Contents
        </Link>
        {nextIndex !== null ? (
          <Link
            href={`/story/${sid}/${nextIndex}`}
            className="border-border text-muted hover:text-foreground rounded border px-4 py-2 text-xs transition-colors"
          >
            Next &rarr;
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}

function NotFound({ message }: { message: string }) {
  return (
    <div className="flex min-h-[calc(100vh-2.75rem)] flex-col items-center justify-center px-6">
      <p className="text-muted text-sm">{message}</p>
    </div>
  );
}
