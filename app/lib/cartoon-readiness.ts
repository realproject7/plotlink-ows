import type { Cut } from "./cuts";

const MAX_EXPORT_SIZE = 1024 * 1024;

export function checkExportSize(fileSizeBytes: number): string | null {
  if (fileSizeBytes > MAX_EXPORT_SIZE) {
    return `Export is ${(fileSizeBytes / 1024).toFixed(0)}KB, exceeds 1MB limit`;
  }
  return null;
}

export function checkCartoonReadiness(cuts: Cut[]): { ready: boolean; issues: string[] } {
  const issues: string[] = [];

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const label = `Cut ${i + 1}`;
    const isNarrationOnly = !cut.cleanImagePath && (cut.narration || cut.dialogue.length > 0);

    if (!isNarrationOnly && !cut.cleanImagePath) {
      issues.push(`${label}: missing clean image`);
    }
    if (!isNarrationOnly && cut.cleanImagePath && cut.overlays.length === 0) {
      issues.push(`${label}: no overlays (text not placed)`);
    }
    if (!isNarrationOnly && cut.cleanImagePath && !cut.finalImagePath) {
      issues.push(`${label}: not exported`);
    }
    if (cut.finalImagePath && !cut.exportedAt) {
      issues.push(`${label}: export metadata missing`);
    }
    if (!cut.uploadedUrl) {
      issues.push(`${label}: not uploaded`);
    }
  }

  return { ready: issues.length === 0, issues };
}

/**
 * Known pre-generation / instructional placeholder prose that an AI writer or a
 * stale template can leave in plot-NN.md. None of this belongs in publish-facing
 * cartoon markdown, which is image-only (plus `ows:cartoon-cut` marker comments).
 * Published immutably, such prose renders as junk above the comic — exactly what
 * happened in storyline #57 / plot 1 (#286): the line "Placeholder only. OWS
 * should generate the publish markdown from `plot-01.cuts.json` ..." survived the
 * readiness check because it sat OUTSIDE the cut marker blocks and carried no
 * image reference. Matched case-insensitively anywhere in the markdown.
 *
 * Because the published content is immutable, this list errs toward catching
 * leftovers: a false positive only asks the writer to delete a stray line before
 * publishing, while a false negative bakes the junk on-chain forever.
 */
export const PLACEHOLDER_PROSE_PATTERNS: RegExp[] = [
  /placeholder only/i,
  /\bOWS (?:should )?generates? the publish markdown/i,
  /generate(?:s|d)? the publish markdown from/i,
  /after clean images are approved/i,
  /lettered final images are created/i,
  /do not hand-?write/i,
  /\b(?:TODO|FIXME)\b/,
];

/**
 * Return the first matched placeholder-prose snippet found in the markdown, or
 * null if none. Shared by the publish readiness gate and the markdown generator
 * (which strips these paragraphs so "Generate MD" output stays image-only).
 */
export function findPlaceholderProse(markdown: string): string | null {
  for (const re of PLACEHOLDER_PROSE_PATTERNS) {
    const m = markdown.match(re);
    if (m) return m[0];
  }
  return null;
}

function extractCutBlock(markdown: string, id: string): string | null {
  const start = `<!-- ows:cartoon-cut ${id} start -->`;
  const end = `<!-- ows:cartoon-cut ${id} end -->`;
  const startIdx = markdown.indexOf(start);
  const endIdx = markdown.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null;
  return markdown.slice(startIdx + start.length, endIdx);
}

/**
 * Planning stage = a valid cut plan exists but the publish-facing markdown is
 * still missing the `ows:cartoon-cut` marker block for one or more cuts. In this
 * state the next action is simply "Generate MD" to lay down the skeleton, so the
 * UI should surface that action rather than alarming missing-block publish errors.
 */
export function isCartoonPlanningStage(markdown: string, cuts: Cut[]): boolean {
  if (cuts.length === 0) return false;
  for (let i = 0; i < cuts.length; i++) {
    const id = `cut-${String(i + 1).padStart(3, "0")}`;
    if (extractCutBlock(markdown, id) === null) return true;
  }
  return false;
}

export function checkMarkdownReadiness(
  markdown: string,
  cuts: Cut[],
): { ready: boolean; issues: string[] } {
  const issues: string[] = [];

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const label = `Cut ${i + 1}`;
    const id = `cut-${String(i + 1).padStart(3, "0")}`;

    // Every publishable cut must have a recorded uploaded URL.
    if (!cut.uploadedUrl) {
      issues.push(`${label}: not uploaded (no recorded uploaded URL)`);
    }

    const block = extractCutBlock(markdown, id);
    if (block === null) {
      issues.push(`${label}: missing or incomplete markdown block`);
      continue;
    }

    // Each completed cut block must contain exactly one image reference whose
    // URL exactly matches the cut's recorded uploadedUrl.
    const refs = [...block.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)].map((m) => m[1].trim());
    if (refs.length === 0) {
      issues.push(`${label}: block has no image reference`);
    } else if (refs.length > 1) {
      issues.push(`${label}: block must contain exactly one image reference`);
    } else if (cut.uploadedUrl && refs[0] !== cut.uploadedUrl) {
      issues.push(`${label}: image URL does not match the recorded uploaded URL`);
    }
  }

  if (/awaiting upload|image pending|final image pending|pending upload/i.test(markdown)) {
    issues.push("Markdown contains awaiting-upload placeholders");
  }

  // Reject pre-generation / instructional placeholder prose anywhere in the
  // markdown — not just inside cut blocks. This is what leaked on-chain in #286.
  const placeholderProse = findPlaceholderProse(markdown);
  if (placeholderProse) {
    issues.push(
      `This episode still has placeholder/instructional text ("${placeholderProse.slice(0, 60)}") — remove it or re-run “Prepare episode for publish” so the published episode is images only`,
    );
  }

  // Every image reference anywhere in the markdown must be (1) an http(s) URL
  // and (2) a recorded cut uploadedUrl. The http(s) check is independent so a
  // bad recorded uploadedUrl (e.g. a local "assets/..." path) cannot be matched
  // by equally-bad local markdown. The Set check rejects stray/extra https refs
  // (outside or in duplicate cut blocks) not tied to a real uploaded cut image.
  const uploadedUrls = new Set(
    cuts.map((c) => c.uploadedUrl).filter((u): u is string => !!u && /^https?:\/\//i.test(u)),
  );
  const allRefs = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)];
  for (const ref of allRefs) {
    const url = ref[1].trim();
    if (!/^https?:\/\//i.test(url)) {
      issues.push(`Invalid image reference (not an http(s) URL): ${url.slice(0, 60)}`);
    } else if (!uploadedUrls.has(url)) {
      issues.push(`Image reference is not a recorded uploaded cut URL: ${url.slice(0, 60)}`);
    }
  }

  if (markdown.length > 10000) {
    issues.push(`Markdown is ${markdown.length} chars (limit 10,000)`);
  }

  return { ready: issues.length === 0, issues };
}

export type CartoonReadinessStage =
  | "planning"
  | "awaiting-upload"
  | "error"
  | "ready";

export interface CartoonReadinessReport {
  stage: CartoonReadinessStage;
  issues: string[];
  awaitingCount: number;
  totalCuts: number;
}

/**
 * Classify cartoon publish readiness into a single stage so the UI can render
 * the right affordance instead of dumping every gating reason as a red error.
 *
 * - "planning": one or more cut marker blocks are not generated yet → Generate MD.
 * - "awaiting-upload": every cut block exists but images are not uploaded yet.
 *   This is the normal post-`Generate MD` intermediate state, NOT an error.
 * - "error": genuinely malformed markdown / invalid references / size, etc.
 * - "ready": fully publishable.
 *
 * This does NOT relax the publish gate: `checkMarkdownReadiness` (used by the
 * server in routes/publish.ts) is unchanged, so awaiting-upload markdown still
 * cannot be published. We only reclassify how it is presented.
 */
export function classifyCartoonReadiness(
  markdown: string,
  cuts: Cut[],
): CartoonReadinessReport {
  const totalCuts = cuts.length;

  if (isCartoonPlanningStage(markdown, cuts)) {
    return { stage: "planning", issues: [], awaitingCount: 0, totalCuts };
  }

  const { ready, issues } = checkMarkdownReadiness(markdown, cuts);
  if (ready) {
    return { stage: "ready", issues: [], awaitingCount: 0, totalCuts };
  }

  // A cut is "awaiting upload" when its marker block exists, contains no image
  // reference, and the cut has no recorded uploaded URL — i.e. the intentional
  // skeleton placeholder produced by Generate MD.
  const awaitingLabels = new Set<string>();
  for (let i = 0; i < cuts.length; i++) {
    const label = `Cut ${i + 1}`;
    const id = `cut-${String(i + 1).padStart(3, "0")}`;
    const block = extractCutBlock(markdown, id);
    if (block === null) continue;
    const hasImage = /!\[[^\]]*\]\([^)]*\)/.test(block);
    if (!hasImage && !cuts[i].uploadedUrl) {
      awaitingLabels.add(label);
    }
  }

  // Filter out the expected awaiting-upload "noise" so only genuine problems
  // remain. Anything left means the markdown is actually malformed.
  const awaitingNoise = new Set<string>(["Markdown contains awaiting-upload placeholders"]);
  for (const label of awaitingLabels) {
    awaitingNoise.add(`${label}: not uploaded (no recorded uploaded URL)`);
    awaitingNoise.add(`${label}: block has no image reference`);
  }

  const realIssues = issues.filter((issue) => !awaitingNoise.has(issue));

  if (realIssues.length > 0) {
    return {
      stage: "error",
      issues: realIssues,
      awaitingCount: awaitingLabels.size,
      totalCuts,
    };
  }

  return {
    stage: "awaiting-upload",
    issues: [],
    awaitingCount: awaitingLabels.size,
    totalCuts,
  };
}

// Short, writer-facing reminder that clean images are art only. Shown in the
// workflow guide so a first-time creator doesn't bake dialogue/SFX into the
// generated art (the lettering step adds those) (#335).
export const CARTOON_CLEAN_IMAGE_HELP =
  "Clean images are the artwork only — no dialogue, narration, sound effects, or speech bubbles. You add those in the lettering step.";

/**
 * Per-cut production progress, derived straight from cuts.json + local asset
 * paths + uploaded URLs (#335). Drives the granular workflow checklist so each
 * production step shows real status, not just a coarse stage.
 *
 * MVP rule (#335, operator finding on PR #338): EVERY current-schema cut is
 * treated as image-required, so `needClean === total`. A planned cut carries its
 * dialogue/narration in cuts.json before any art exists, so it looks identical
 * to a deliberately text-only cut — inferring "narration-only" from
 * `!cleanImagePath && narration/dialogue` would wrongly mark a brand-new planned
 * cut as needing no image and skip the writer straight past "Create clean
 * images". Counting all cuts as image-required matches the agent guidance that
 * every publishable cut gets a clean → final → uploaded image.
 */
export interface CartoonCutProgress {
  total: number;
  /** Cuts that require a clean image. For MVP this is every cut (= total). */
  needClean: number;
  /** Of `needClean`, how many have a clean image recorded. */
  withClean: number;
  /** Of the clean-image cuts, how many have text overlays placed. */
  withText: number;
  /** Of the clean-image cuts, how many have an exported final image. */
  exported: number;
  /** Cuts with a recorded uploaded URL. */
  uploaded: number;
}

export function summarizeCutProgress(cuts: Cut[]): CartoonCutProgress {
  let withClean = 0;
  let withText = 0;
  let exported = 0;
  let uploaded = 0;
  for (const cut of cuts) {
    if (cut.cleanImagePath) {
      withClean++;
      if (cut.overlays.length > 0) withText++;
      if (cut.finalImagePath && cut.exportedAt) exported++;
    }
    if (cut.uploadedUrl) uploaded++;
  }
  // MVP: every cut is image-required, so needClean === total.
  return { total: cuts.length, needClean: cuts.length, withClean, withText, exported, uploaded };
}

export type CartoonStepKey = "plan" | "clean" | "letter" | "export" | "upload" | "publish";

export interface CartoonChecklistStep {
  key: CartoonStepKey;
  /** Writer-facing label — product language, no build/file jargon (#335). */
  label: string;
  status: "done" | "current" | "todo";
  /** Short progress detail like "3 / 6 cuts", or null when not countable. */
  detail: string | null;
}

export interface CartoonChecklist {
  steps: CartoonChecklistStep[];
  nextStep: string | null;
}

const CHECKLIST_LABELS: Record<CartoonStepKey, string> = {
  plan: "Plan cuts",
  clean: "Create clean images",
  letter: "Add speech bubbles & captions",
  export: "Export final images",
  upload: "Upload final images",
  publish: "Publish to PlotLink",
};

function fraction(done: number, total: number): string {
  return `${done} / ${total} cut${total === 1 ? "" : "s"}`;
}

/**
 * Granular, writer-facing production checklist for a cartoon episode (#335).
 * Expands the old 4-milestone guide into the six steps a creator actually
 * performs — plan cuts → create clean images → add bubbles → export → upload →
 * publish — and derives each step's status from real per-cut progress (clean
 * images, overlays, exports, uploads) plus the file's publish status. The first
 * incomplete step is "current"; everything before it is "done", after it "todo"
 * (a linear checklist), and `nextStep` spells out the next action in plain
 * language. Returns no steps when there is no cut plan yet (non-cartoon or an
 * empty/unparsed plan), so the guide simply doesn't render there.
 */
export function cartoonChecklist(input: { cuts: Cut[]; published?: boolean }): CartoonChecklist {
  const { cuts, published = false } = input;
  const p = summarizeCutProgress(cuts);
  if (p.total === 0) return { steps: [], nextStep: null };

  const planDone = p.total > 0;
  const cleanDone = planDone && p.withClean === p.needClean;
  const letterDone = cleanDone && p.withText === p.needClean;
  const exportDone = letterDone && p.exported === p.needClean;
  const uploadDone = exportDone && p.uploaded === p.total;
  const publishDone = uploadDone && published;

  const complete: Record<CartoonStepKey, boolean> = {
    plan: planDone,
    clean: cleanDone,
    letter: letterDone,
    export: exportDone,
    upload: uploadDone,
    publish: publishDone,
  };
  const order: CartoonStepKey[] = ["plan", "clean", "letter", "export", "upload", "publish"];
  const currentIdx = order.findIndex((k) => !complete[k]);

  // needClean === total (every cut is image-required for MVP), and total > 0
  // here, so the image-step denominators are always countable.
  const detail: Record<CartoonStepKey, string | null> = {
    plan: fraction(p.total, p.total),
    clean: fraction(p.withClean, p.needClean),
    letter: fraction(p.withText, p.needClean),
    export: fraction(p.exported, p.needClean),
    upload: fraction(p.uploaded, p.total),
    publish: null,
  };

  const steps: CartoonChecklistStep[] = order.map((key, i) => ({
    key,
    label: CHECKLIST_LABELS[key],
    status: currentIdx === -1 ? "done" : i < currentIdx ? "done" : i === currentIdx ? "current" : "todo",
    detail: detail[key],
  }));

  const NEXT: Record<CartoonStepKey, string> = {
    plan: "Plan the episode's cuts to begin.",
    clean: "Create a clean image for each cut — artwork only, no text or bubbles.",
    letter: "Open each cut in the lettering editor and place its speech bubbles and captions.",
    export: "Export the lettered final image for each cut.",
    upload: "Upload the exported final images so they're ready to publish.",
    publish: "Preview the episode, then publish to PlotLink.",
  };
  const nextStep = currentIdx === -1 ? "Published — this episode is live on PlotLink." : NEXT[order[currentIdx]];

  return { steps, nextStep };
}
