/** Cover image constraints enforced by the plotlink backend. */
export const COVER_MAX_BYTES = 1024 * 1024;
export const COVER_ALLOWED_TYPES = ["image/webp", "image/jpeg"] as const;

/**
 * Writer-facing cover requirements, surfaced in the cartoon cover step (#337):
 * the enforced format/size plus the recommended portrait shape and a reminder to
 * use clean cover art (AI-generated lettering often renders as unreadable text).
 */
export const COVER_GUIDANCE =
  "Cover: WebP or JPEG, max 1MB, 600×900 portrait recommended. Use clean cover art — avoid unreadable AI text or broken lettering.";

export type CoverReadinessState = "none" | "selected" | "invalid" | "attached";

export interface CoverReadiness {
  state: CoverReadinessState;
  /** Short writer-facing status line. */
  label: string;
  /** Visual tone hint for the badge. */
  tone: "muted" | "accent" | "error" | "success";
}

/**
 * Resolve the cartoon cover readiness shown next to publish (#337) so a writer
 * always sees whether a cover is missing, queued, invalid, or attached before
 * the story goes out. Precedence: an already-attached storyline cover wins;
 * then an invalid selection (so the error is never hidden by a stale pick);
 * then a valid local cover queued for upload; otherwise none yet.
 */
export function cartoonCoverReadiness(input: {
  /** A valid local cover file is queued (will upload at publish). */
  hasSelectedCover: boolean;
  /** The latest selection/detection was rejected (wrong type / too large). */
  invalid: boolean;
  /** A cover is already attached on the published storyline. */
  attached: boolean;
}): CoverReadiness {
  if (input.attached) {
    return { state: "attached", label: "Cover attached to your story.", tone: "success" };
  }
  if (input.invalid) {
    return { state: "invalid", label: "Cover file can't be used — must be WebP or JPEG, max 1MB.", tone: "error" };
  }
  if (input.hasSelectedCover) {
    return { state: "selected", label: "Cover selected — it will be uploaded when you publish.", tone: "accent" };
  }
  return { state: "none", label: "No cover yet — add one before publishing (recommended).", tone: "muted" };
}

/**
 * Validate a chosen story cover against the constraints the plotlink backend
 * enforces (WebP/JPEG, ≤1MB) so the writer gets immediate feedback at selection
 * rather than a late error at save. Pure — takes only size/type — and shared by
 * fiction and cartoon (the cover route is content-type agnostic). The 600x900
 * portrait guidance is a recommendation and is not enforced here. Returns a
 * user-facing error string, or null when the file is acceptable.
 */
export function validateCoverImage(file: { size: number; type: string }): string | null {
  if (file.size > COVER_MAX_BYTES) return "Image exceeds 1MB limit";
  if (!(COVER_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return "Only WebP and JPEG images are accepted";
  }
  return null;
}

type AuthFetch = (url: string, opts?: RequestInit) => Promise<Response>;

/**
 * Attach a pre-publish cover to a freshly-created storyline. The on-chain
 * `createStoryline` flow can't carry a cover CID, so after a genesis publishes
 * we upload the selected cover (byte-validated server-side, #281) and set it via
 * the existing `update-storyline` endpoint — the same two-step the published
 * Edit Story panel uses. Best-effort: a failed upload OR a failed
 * update-storyline returns null, so the storyline still stands and the writer
 * can set a cover later via Edit Story. Returns the cover CID only when the
 * cover was actually attached (both steps succeeded), else null.
 */
export async function attachCoverToStoryline(
  authFetch: AuthFetch,
  storylineId: number,
  coverFile: File,
): Promise<string | null> {
  const fd = new FormData();
  fd.append("file", coverFile);
  const upRes = await authFetch("/api/publish/upload-cover", { method: "POST", body: fd });
  if (!upRes.ok) return null;
  const { cid } = (await upRes.json()) as { cid?: string };
  if (!cid) return null;
  const updRes = await authFetch("/api/publish/update-storyline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storylineId, coverCid: cid }),
  });
  // The cover is only attached if update-storyline also succeeds; a non-ok
  // response means the cover was uploaded but never set on the storyline.
  if (!updRes.ok) return null;
  return cid;
}

/** The first markdown H1 (`# Title`) in `content`, trimmed; null when none. */
export function extractH1Title(content: string): string | null {
  const m = content.match(/^#\s+(.+)$/m);
  const t = m ? m[1].trim() : "";
  return t ? t : null;
}

/**
 * Prettify a story folder slug into a human title:
 * "swipe-right-refund-later" → "Swipe Right Refund Later". Used only as the
 * last-resort genesis title so a storyline never publishes as the bare
 * "genesis" filename.
 */
export function prettifyStorySlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Whether a resolved publish title is still a raw internal filename label
 * ("genesis"/"Genesis" for genesis.md, "plot-NN" for a plot) rather than a
 * reader-facing title (#358). The publish panel blocks on this so a cartoon
 * story can't ship raw labels (which are immutable once on-chain). Compared
 * case-insensitively and trimmed.
 */
export function isRawFilenameTitle(title: string, fileName: string): boolean {
  const t = (title ?? "").trim().toLowerCase();
  if (!t) return true;
  if (fileName === "genesis.md") return t === "genesis";
  const m = fileName.match(/^(plot-\d+)\.md$/);
  if (m) return t === m[1].toLowerCase() || /^plot-\d+$/.test(t);
  return false;
}

/**
 * Friendly episode title from a plot filename (#347): "plot-01.md" → "Episode
 * 01" (numbering preserved, padded to ≥2 digits). Returns null for a non-plot
 * filename. Used as the last-resort cartoon episode title so an episode never
 * publishes as the raw "plot-NN" filename.
 */
export function episodeTitleFromPlotFile(fileName: string): string | null {
  const m = fileName.match(/^plot-(\d+)\.md$/);
  if (!m) return null;
  const n = m[1];
  return `Episode ${n.length < 2 ? n.padStart(2, "0") : n}`;
}

/**
 * Whether a cartoon episode title is just a GENERIC number label rather than a
 * reader-facing title (#368): "Episode 01", "Episode 1", "Ep. 01", "Chapter 01",
 * "Plot 01", "plot-01", or a bare number. These pass #365's "has a title" check
 * (they're a real H1 / cut-plan title) but are still placeholders that don't meet
 * webtoon metadata quality, so they must not publish.
 *
 * A title that pairs a number with actual title text — "Episode 01 — The Couple
 * Coupon" — is NOT generic (the regex anchors `$` right after the number, so any
 * trailing title text fails the match). Compared trimmed / case-insensitive.
 */
export function isGenericEpisodeTitle(title: string): boolean {
  const t = (title ?? "").trim();
  if (!t) return true;
  // A generic label word (episode/ep/chapter/ch/part/pt/plot) + a number, with
  // nothing meaningful after the number.
  if (/^(?:episode|ep|chapter|ch|part|pt|plot)\.?\s*[-–—:#]?\s*\d+$/i.test(t)) return true;
  // A bare number ("01", "1"), or a raw filename-style "plot-01"/"plot_1".
  if (/^\d+$/.test(t)) return true;
  if (/^plot[-_\s]?\d+$/i.test(t)) return true;
  return false;
}

/**
 * Whether a cartoon plot has an EXPLICIT reader-facing episode title (#365,
 * tightened by #368): a real `# Title` H1 in the plot markdown, or a non-empty
 * cut-plan title — that is NOT a generic "Episode NN"/"Chapter NN"/"plot-NN"
 * placeholder.
 *
 * #347/#358 stopped raw `plot-NN` titles from publishing by falling back to a
 * friendly "Episode NN"; #365 made that fallback diagnostic-only. #368 closes the
 * remaining gap: a real H1 or cut-plan title that is itself only a generic number
 * label still doesn't satisfy publish-quality webtoon metadata, so it is rejected
 * here too. Independent of the #358 raw-filename block, which is kept.
 */
export function hasExplicitEpisodeTitle(opts: { fileContent: string; episodeTitle?: string | null }): boolean {
  const h1 = extractH1Title(opts.fileContent);
  const cut = opts.episodeTitle?.trim() || null;
  if (h1 && !isGenericEpisodeTitle(h1)) return true;
  if (cut && !isGenericEpisodeTitle(cut)) return true;
  return false;
}

/**
 * Resolve the title used when publishing a story file to PlotLink (#331, #347).
 *
 * The storyline title is set once, at genesis publish, and is immutable
 * on-chain — so a headingless `genesis.md` must NOT fall back to the bare
 * "genesis" filename. For `genesis.md` the title resolves:
 *   1. an explicit `# Title` H1 inside genesis.md, then
 *   2. the `# Title` H1 from the story's structure.md, then
 *   3. a prettified story folder slug — never raw "genesis".
 *
 * For a plot file:
 *   1. an explicit `# Title` H1 in plot-NN.md, then
 *   2. for CARTOON content (its publish markdown is image-only by design, so it
 *      usually has no H1): the cut plan's episode title, else a friendly
 *      "Episode NN" — NEVER the raw "plot-NN" filename (#347).
 *   3. for fiction: the prior H1-or-filename behavior, unchanged.
 *
 * A plot's title does not change the storyline title on-chain (createStoryline
 * set it; chainPlot uses this for the chapter). Result is capped at 60 chars.
 */
export function derivePublishTitle(opts: {
  fileName: string;
  fileContent: string;
  storySlug: string;
  structureContent?: string | null;
  contentType?: string;
  /** Episode title from plot-NN.cuts.json, if any (cartoon). */
  episodeTitle?: string | null;
}): string {
  const { fileName, fileContent, storySlug, structureContent, contentType, episodeTitle } = opts;
  const ownH1 = extractH1Title(fileContent);

  if (fileName === "genesis.md") {
    const structureH1 = structureContent ? extractH1Title(structureContent) : null;
    return (ownH1 ?? structureH1 ?? prettifyStorySlug(storySlug)).slice(0, 60);
  }

  // Plot file.
  if (ownH1) return ownH1.slice(0, 60);
  if (contentType === "cartoon") {
    const fromCuts = episodeTitle?.trim();
    const friendly = episodeTitleFromPlotFile(fileName);
    return ((fromCuts || friendly) ?? fileName.replace(/\.md$/, "")).slice(0, 60);
  }
  return fileName.replace(/\.md$/, "").slice(0, 60);
}

/** Minimal publish-status record shape needed to reason about plot duplicates. */
export interface PlotPublishRecord {
  status?: "published" | "published-not-indexed" | "pending" | "draft";
  storylineId?: number;
  plotIndex?: number;
  txHash?: string;
}

/**
 * Whether a plot file already has a successful on-chain `chainPlot` recorded
 * (#332). A minted chapter records its txHash + storyline + plotIndex; editing
 * the file later resets `status` to "pending" but KEEPS those fields, so the
 * presence of a txHash and a real plotIndex (>0) is the reliable signal that a
 * chapter for this file already exists on PlotLink — republishing would mint a
 * permanent duplicate chapter.
 */
export function hasPriorOnChainPlot(record: PlotPublishRecord | null | undefined): boolean {
  return !!record?.txHash && record?.plotIndex != null && record.plotIndex > 0;
}

/**
 * Whether a fresh `chainPlot` mint for this plot file must be BLOCKED to avoid a
 * duplicate chapter (#332). Blocks whenever the file already has an on-chain
 * chapter, EXCEPT the `published-not-indexed` state: there the on-chain tx
 * exists but indexing failed, so the recovery flow (Retry Index, or an
 * explicitly-confirmed Retry Publish in the UI) is intentional and handled
 * separately. A first-time publish (no prior txHash) is never blocked, so
 * existing fiction/cartoon first-publish behavior is unchanged.
 */
export function shouldBlockDuplicatePlotPublish(record: PlotPublishRecord | null | undefined): boolean {
  return hasPriorOnChainPlot(record) && record?.status !== "published-not-indexed";
}

export function getContentTypeForPublish(
  storyContentTypes: Record<string, string>,
  storyName: string,
  storylineId: number | undefined,
): string | undefined {
  if (storyContentTypes[storyName] === "cartoon" && !storylineId) {
    return "cartoon";
  }
  return undefined;
}

/**
 * Resolve the effective content type for the currently-selected story, falling
 * back to the pending `_new_*` draft map before persistence.
 *
 * A freshly-created cartoon draft has no `.story.json` yet, so it is absent from
 * the persisted `storyContentTypes` state; its type lives only in the in-memory
 * pending map (`contentTypeMap`) until the rename/persist completes. Preview and
 * terminal-launch gating must both see "cartoon" immediately — otherwise a new
 * cartoon draft's terminal could launch before Codex readiness gating applies.
 *
 * Order: persisted state → pending draft map → "fiction" default. Returns
 * undefined only when no story is selected.
 */
/**
 * Pure predicate: does a story need the explicit legacy-cartoon provider repair?
 *
 * True ONLY when ALL of:
 *  - the resolved content type is "cartoon", AND
 *  - no provider is recorded on the story (legacy `.story.json` with no
 *    `agentProvider`; absent ⇒ would default to Claude at launch), AND
 *  - it is a real, persisted story (NOT a `_new_*` draft — new drafts already
 *    force codex at creation, #254).
 *
 * Fiction, a cartoon that already has a provider, or a `_new_*` draft ⇒ false.
 * This is read-only detection: it never writes or migrates anything.
 */
export function needsLegacyProviderRepair(
  contentType: "fiction" | "cartoon" | undefined,
  agentProvider: "claude" | "codex" | undefined,
  storyName: string | null,
): boolean {
  if (contentType !== "cartoon") return false;
  if (agentProvider) return false;
  if (!storyName || storyName.startsWith("_new_")) return false;
  return true;
}

export function resolveSelectedContentType(
  selectedStory: string | null,
  storyContentTypes: Record<string, "fiction" | "cartoon">,
  pendingContentTypes: Map<string, "fiction" | "cartoon">,
): "fiction" | "cartoon" | undefined {
  if (!selectedStory) return undefined;
  return (
    storyContentTypes[selectedStory] ||
    pendingContentTypes.get(selectedStory) ||
    "fiction"
  );
}
