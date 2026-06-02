import { isRawFilenameTitle, isGenericEpisodeTitle } from "./publish-helpers";

/**
 * End-to-end public-title verification for cartoon publishes (#379).
 *
 * Local guards (#347/#358/#365/#368) ensure OWS *sends* a reader-facing title,
 * but the real pilot (`plotlink.xyz/story/59/1` rendered `genesis` / `plot-01`)
 * showed we must also prove the PUBLIC, indexed metadata is reader-facing — not
 * just that local preview computed a good label. After indexing, OWS reads the
 * indexed storyline detail and verifies the title here. Already-published bad
 * titles are immutable, so this can only warn + keep the next publish honest.
 */

/** Subset of PlotLink's `GET /api/storyline/<id>` response we read for #379. */
export interface PublicStorylineDetail {
  title?: string;
  name?: string;
  // PlotLink may expose per-episode entries (plots/chapters) with their own
  // title + index; we read whichever is present, matching by plot index.
  plots?: Array<{ title?: string; name?: string; index?: number; plotIndex?: number }>;
  chapters?: Array<{ title?: string; name?: string; index?: number; plotIndex?: number }>;
}

export interface PublicTitleVerdict {
  /** false → the indexed public title is raw/generic (verification failed). */
  ok: boolean;
  /** false → the relevant public title field was absent (read inconclusive). */
  checked: boolean;
  /** the public title actually evaluated, when present. */
  publicTitle?: string;
  /** human-facing failure reason, when ok === false. */
  reason?: string;
}

/** Find the public title for a plot index across whichever list PlotLink returns. */
function pickPlotTitle(detail: PublicStorylineDetail, plotIndex: number | undefined): string | undefined {
  const lists = [detail.plots, detail.chapters].filter(Boolean) as NonNullable<PublicStorylineDetail["plots"]>[];
  for (const list of lists) {
    const byIndex =
      plotIndex != null ? list.find((p) => p.plotIndex === plotIndex || p.index === plotIndex) : undefined;
    let entry = byIndex;
    if (!entry && list.length === 1) {
      // Fall back to the lone entry ONLY when it carries no index to match on
      // (or the caller gave no index) — never when a known index simply differs,
      // which would verify the wrong episode.
      const only = list[0];
      const hasIndex = only.plotIndex != null || only.index != null;
      if (!hasIndex || plotIndex == null) entry = only;
    }
    const t = (entry?.title ?? entry?.name)?.trim();
    if (t) return t;
  }
  return undefined;
}

/**
 * Verify the indexed PlotLink title for a cartoon publish is reader-facing.
 * Genesis (storyline) titles must not be the raw `genesis` fallback; plot titles
 * must not be `plot-NN` or a generic `Episode NN` placeholder. Returns
 * `checked: false` when the relevant public title is absent, so the caller never
 * false-fails an inconclusive read (e.g. a transient indexer response).
 */
export function verifyPublicCartoonTitle(opts: {
  fileName: string;
  detail: PublicStorylineDetail | null | undefined;
  plotIndex?: number;
}): PublicTitleVerdict {
  const { fileName, detail, plotIndex } = opts;
  if (!detail) return { ok: true, checked: false };

  if (fileName === "genesis.md") {
    const publicTitle = (detail.title ?? detail.name)?.trim();
    if (!publicTitle) return { ok: true, checked: false };
    if (isRawFilenameTitle(publicTitle, "genesis.md")) {
      return {
        ok: false,
        checked: true,
        publicTitle,
        reason: `PlotLink indexed the storyline title as “${publicTitle}”, a raw filename rather than the reader-facing title.`,
      };
    }
    return { ok: true, checked: true, publicTitle };
  }

  const publicTitle = pickPlotTitle(detail, plotIndex);
  if (!publicTitle) return { ok: true, checked: false };
  if (isRawFilenameTitle(publicTitle, fileName) || isGenericEpisodeTitle(publicTitle)) {
    return {
      ok: false,
      checked: true,
      publicTitle,
      reason: `PlotLink indexed the episode title as “${publicTitle}”, a generic placeholder rather than a reader-facing episode title.`,
    };
  }
  return { ok: true, checked: true, publicTitle };
}

/** Durable, writer-facing warning shown when public-title verification fails (#379). */
export function publicTitleWarning(verdict: PublicTitleVerdict): string {
  return (
    `${verdict.reason ?? "PlotLink indexed a raw/generic public title for this publish."} ` +
    `Published metadata is immutable on-chain and cannot be edited — the next publish must use corrected, reader-facing metadata. ` +
    `(The webtoon pilot stays blocked until a publish indexes a real public title.)`
  );
}
