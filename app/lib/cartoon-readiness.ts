import { isStaleTailedExport, isTextPanel, type Cut } from "./cuts";

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
    // Text/interstitial panels (#350) have no clean image — they render text on
    // a styled background — so they skip the clean-image/lettering gating, but
    // (like every panel) still export + upload a final image before publish.
    const textPanel = isTextPanel(cut);
    const isNarrationOnly = !cut.cleanImagePath && (cut.narration || cut.dialogue.length > 0);

    if (!textPanel && !isNarrationOnly && !cut.cleanImagePath) {
      issues.push(`${label}: missing clean image`);
    }
    if (!textPanel && !isNarrationOnly && cut.cleanImagePath && cut.overlays.length === 0) {
      issues.push(`${label}: no overlays (text not placed)`);
    }
    if (!textPanel && !isNarrationOnly && cut.cleanImagePath && !cut.finalImagePath) {
      issues.push(`${label}: not exported`);
    }
    if (textPanel && !cut.finalImagePath) {
      issues.push(`${label}: not exported`);
    }
    if (cut.finalImagePath && !cut.exportedAt) {
      issues.push(`${label}: export metadata missing`);
    }
    if (isStaleTailedExport(cut)) {
      issues.push(staleTailedExportIssue(label));
    }
    if (!cut.uploadedUrl) {
      issues.push(`${label}: not uploaded`);
    }
  }

  return { ready: issues.length === 0, issues };
}

function staleTailedExportIssue(label: string): string {
  return `${label}: re-export required before publish — this final image uses an older speech-bubble tail style that can show a visible seam`;
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

  // Fail closed for an empty cut plan (#422). With zero cuts the per-cut loop
  // below never runs and an instructional-but-unmatched placeholder plot-NN.md
  // would otherwise report ready=true — letting a not-started episode publish a
  // blank/placeholder page on-chain via the direct API gate. A 0-cut episode is
  // never publishable.
  if (cuts.length === 0) {
    return { ready: false, issues: ["This episode has no cuts planned yet — plan and produce its cuts before publishing."] };
  }

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const label = `Cut ${i + 1}`;
    const id = `cut-${String(i + 1).padStart(3, "0")}`;

    // Every publishable cut must have a recorded uploaded URL.
    if (!cut.uploadedUrl) {
      issues.push(`${label}: not uploaded (no recorded uploaded URL)`);
    }
    if (isStaleTailedExport(cut)) {
      issues.push(staleTailedExportIssue(label));
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
  // No cuts planned yet — a scaffold placeholder / future episode (#422). This is
  // a calm "not started" state, NOT an error: an empty cut plan can't be
  // publishable, but it also shouldn't surface alarming publish warnings.
  | "not-started"
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

  // An empty cut plan is a not-started placeholder / future episode (#422), not
  // an error. Classify it first so a placeholder plot-NN.md (instructional prose,
  // no cuts) reads as "not started yet" instead of dumping placeholder-prose /
  // missing-block publish errors. The publish gate is unaffected — a 0-cut plan
  // is never `ready`.
  if (totalCuts === 0) {
    return { stage: "not-started", issues: [], awaitingCount: 0, totalCuts: 0 };
  }

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

/** One step-categorized group of publish-readiness issues for display (#360). */
export interface CartoonIssueGroup {
  /** Stable category key. */
  key: string;
  /** Writer-facing step heading. */
  title: string;
  /** Issue lines in this group, with repeated per-cut reasons collapsed. */
  lines: string[];
}

// Maps a raw readiness issue string to a workflow step, so the publish panel can
// show grouped, plain-language headings instead of a flat wall of repeated
// per-cut technical errors (#360). Ordered by where the step sits in the flow.
const CARTOON_ISSUE_CATEGORIES: { key: string; title: string; test: RegExp }[] = [
  { key: "assemble", title: "Prepare the episode for publish", test: /markdown block|missing or incomplete/i },
  { key: "export", title: "Export final images", test: /re-export|older speech-bubble|visible seam/i },
  { key: "upload", title: "Upload final images", test: /not uploaded|no recorded uploaded url/i },
  { key: "images", title: "Fix image references", test: /image reference|not an http|does not match|exactly one image/i },
  { key: "cleanup", title: "Remove leftover text", test: /placeholder|instructional|awaiting-upload|awaiting upload/i },
  { key: "size", title: "Shorten the episode", test: /\blimit\b|\bchars\b/i },
];

// Collapse repeated "Cut N: <reason>" lines that share a reason into one
// "Cuts 1, 3, 5: <reason>" line; non-cut lines pass through unchanged.
function collapseCutLines(items: string[]): string[] {
  const byReason = new Map<string, number[]>();
  const order: string[] = [];
  const passthrough: string[] = [];
  for (const it of items) {
    const m = it.match(/^Cut (\d+): (.+)$/);
    if (m) {
      const reason = m[2];
      if (!byReason.has(reason)) { byReason.set(reason, []); order.push(reason); }
      byReason.get(reason)!.push(Number(m[1]));
    } else {
      passthrough.push(it);
    }
  }
  const collapsed = order.map((reason) => {
    const nums = byReason.get(reason)!.slice().sort((a, b) => a - b);
    const label = nums.length === 1 ? `Cut ${nums[0]}` : `Cuts ${nums.join(", ")}`;
    return `${label}: ${reason}`;
  });
  return [...collapsed, ...passthrough];
}

/**
 * Group flat publish-readiness issues by workflow step for the cartoon publish
 * panel (#360). A non-technical writer sees "Upload final images" / "Prepare the
 * episode for publish" headings with collapsed per-cut lines, instead of a long
 * repeated list of "Cut N: not uploaded" technical errors. Unmatched issues fall
 * into an "Other issues" group so nothing is dropped. Order follows the workflow.
 */
export function groupCartoonIssues(issues: string[]): CartoonIssueGroup[] {
  const catKey = (issue: string) =>
    CARTOON_ISSUE_CATEGORIES.find((c) => c.test.test(issue))?.key ?? "other";
  const buckets = new Map<string, string[]>();
  for (const issue of issues) {
    const k = catKey(issue);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(issue);
  }
  const order = [...CARTOON_ISSUE_CATEGORIES.map((c) => c.key), "other"];
  const titleOf = (k: string) =>
    CARTOON_ISSUE_CATEGORIES.find((c) => c.key === k)?.title ?? "Other issues";
  const groups: CartoonIssueGroup[] = [];
  for (const k of order) {
    const items = buckets.get(k);
    if (!items || items.length === 0) continue;
    groups.push({ key: k, title: titleOf(k), lines: collapseCutLines(items) });
  }
  return groups;
}

/**
 * Cartoon Genesis is the reader-facing opening/prologue: on PlotLink, readers
 * encounter `genesis.md` before plot-01, so it must read as the actual story
 * opening — premise, lead, stakes, tone — and bridge into Episode 01, NOT a
 * back-cover synopsis, genre pitch, outline, or generic intro page (#400,
 * tightening #359/#380). For cartoon MVP quality these are hard publish blockers
 * rather than soft nudges: a weak Genesis bakes metadata-shaped junk in front of
 * readers on-chain, where it is immutable.
 *
 * Blockers (each disables publish):
 *  - no real `# Title` heading — the opening needs a title readers see first (and
 *    the on-chain title would otherwise fall back to a non-reader-facing label),
 *  - too short to onboard a reader,
 *  - synopsis/outline shape (metadata labels / mostly bullets, no opening prose),
 *  - a single dense block with no buildup (a cold-open fragment, not a prologue).
 *
 * `warnings` is retained for future non-blocking nudges; #400 produces none.
 *
 * Fiction genesis does not use this — callers gate on `isCartoonGenesis`, so
 * fiction Genesis behavior is unchanged.
 */
export interface CartoonGenesisReadiness {
  /** Whether `genesis.md` has a real (non-empty) `# Title` H1 heading. */
  hasTitle: boolean;
  /** Hard problems — publish is disabled while any exist. */
  blockers: string[];
  /** Soft nudges shown before publish but not blocking (currently unused). */
  warnings: string[];
}

/** Below this many prose chars (H1 stripped), a cartoon Genesis is too thin to onboard a reader. */
export const GENESIS_MIN_BODY_CHARS = 220;

/** Metadata-label line shapes a synopsis/outline leaves behind ("Logline:", "Characters -", …). */
const GENESIS_METADATA_LABEL =
  /^(genre|logline|synopsis|premise|setting|tone|theme|themes|summary|hook|characters?|cast|arc|status|word\s*count|length|title)\b\s*[:\-–]/i;

export function cartoonGenesisReadiness(content: string): CartoonGenesisReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const text = content ?? "";

  // 1. Real H1 title (hard block). Horizontal whitespace only after `#` so a
  // blank "# " line doesn't absorb the next paragraph as a fake title.
  const h1 = text.match(/^#[ \t]+(.+)$/m);
  const hasTitle = !!(h1 && h1[1].trim());
  if (!hasTitle) {
    blockers.push(
      'Add a “# Title” heading — the Story opening needs a real title readers see first.',
    );
  }

  // Body = everything but the H1 line, used for the length / shape heuristics.
  const body = text.replace(/^#\s+.+$/m, "").trim();

  // 2. Too short to onboard a reader (block). A real opening needs the premise,
  // the lead, and the stakes — not a one-line setup.
  if (body.length < GENESIS_MIN_BODY_CHARS) {
    blockers.push(
      "This Story opening is too short. Open the story for readers — the premise, the lead, and the stakes across a few short paragraphs that bridge into Episode 01, not a one-line setup.",
    );
  } else {
    // 3. Synopsis/outline shape rather than a reader-facing opening scene (block).
    // Skipped when already blocked for length so a tiny stub raises one reason.
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const listish = lines.filter(
      (l) => /^([-*+]|\d+[.)])\s/.test(l) || GENESIS_METADATA_LABEL.test(l),
    ).length;
    const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const hasProseParagraph = paragraphs.some(
      (p) =>
        p.length >= 120 &&
        !/^([-*+]|\d+[.)])\s/.test(p) &&
        !GENESIS_METADATA_LABEL.test(p),
    );
    if ((lines.length > 0 && listish / lines.length >= 0.5) || !hasProseParagraph) {
      blockers.push(
        "This reads like a synopsis or outline. Write the Genesis as a reader-facing opening scene that sets up the first beat and stakes, then bridges into Episode 01 — not a logline, genre pitch, or character list.",
      );
    } else {
      // 4. Real prose, but a single dense block with no buildup (block, #380/#400):
      // a single dense block reads as a cold open rather than a prologue. A real
      // opening builds across a few short paragraphs (premise → what the lead
      // wants → hook → bridge into Episode 01). Count substantial prose
      // paragraphs (not lists/metadata).
      const proseParas = paragraphs.filter(
        (p) => p.length >= 40 && !/^([-*+]|\d+[.)])\s/.test(p) && !GENESIS_METADATA_LABEL.test(p),
      );
      if (proseParas.length < 2) {
        blockers.push(
          "Give the opening room to build: open across a few short paragraphs — the premise, what the lead wants, and the hook — that lead into Episode 01, instead of a single dense block that drops readers into a cold scene.",
        );
      }
    }
  }

  return { hasTitle, blockers, warnings };
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
  /** Cuts that require a clean image — image cuts only; text panels excluded (#350). */
  needClean: number;
  /** Of `needClean`, how many have a clean image recorded. */
  withClean: number;
  /** Cuts with lettering overlays placed. Image cuts still require clean art first; text panels are first-class lettering targets. */
  withText: number;
  /** Cuts (any kind) with an exported final image. */
  exported: number;
  /** Cuts (any kind) with a recorded uploaded URL. */
  uploaded: number;
}

/**
 * A clean-image path is a publishable format only when it's WebP/JPEG (#441).
 * Pure path-extension check (browser-safe, no fs) mirroring the publish-strict
 * `CLEAN_IMAGE_VALID_EXT`; a `.png` is a convert-me intermediate, not finished.
 */
export function isSupportedCleanImage(cleanImagePath: string): boolean {
  return /\.(webp|jpe?g)$/i.test(cleanImagePath);
}

export function summarizeCutProgress(cuts: Cut[]): CartoonCutProgress {
  let needClean = 0;
  let withClean = 0;
  let withText = 0;
  let exported = 0;
  let uploaded = 0;
  for (const cut of cuts) {
    // Image cuts need a clean image → lettering; text/interstitial panels (#350)
    // do not (they're text on a styled background). Text panels still require
    // lettering overlays before the shared workflow can advance to export (#488).
    if (!isTextPanel(cut)) {
      needClean++;
      // A PNG clean image is a draft intermediate, not a finished clean asset
      // (#441): it must be converted to WebP/JPEG first, so it does NOT count as
      // "clean" — the cut sits at the convert step, not lettering. Matches the
      // publish-strict WebP/JPEG requirement without a disk read (path ext only).
      if (cut.cleanImagePath && isSupportedCleanImage(cut.cleanImagePath)) {
        withClean++;
        // Guard a malformed/legacy cut missing `overlays` — the checklist runs on
        // every cut-list render now (#414), so a bad persisted cut must not crash it.
        if ((cut.overlays?.length ?? 0) > 0) withText++;
      }
    } else if ((cut.overlays?.length ?? 0) > 0) {
      withText++;
    }
    if (cut.finalImagePath && cut.exportedAt) exported++;
    if (cut.uploadedUrl) uploaded++;
  }
  return { total: cuts.length, needClean, withClean, withText, exported, uploaded };
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

  // Clean gates only IMAGE cuts (needClean); lettering/export/upload gate EVERY
  // cut including text panels. Text panels need no clean art, but they are still
  // editable lettering targets before export (#488).
  const planDone = p.total > 0;
  const cleanDone = planDone && p.withClean === p.needClean;
  const letterDone = cleanDone && p.withText === p.total;
  const exportDone = letterDone && p.exported === p.total;
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

  // Clean counts image cuts (needClean); lettering/export/upload count every cut
  // (total). An all-text-panel episode has needClean === 0 → "no image cuts".
  const imageDetail = (done: number) => (p.needClean > 0 ? fraction(done, p.needClean) : "no image cuts");
  const detail: Record<CartoonStepKey, string | null> = {
    plan: fraction(p.total, p.total),
    clean: imageDetail(p.withClean),
    letter: fraction(p.withText, p.total),
    export: fraction(p.exported, p.total),
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

/**
 * Context for the preview action-bar footer guidance (#422). The cartoon
 * scaffold mixes an outline (structure.md), a Genesis-as-Episode-1 (genesis.md
 * + genesis.cuts.json), and future-episode placeholders (plot-NN.md +
 * empty-cuts plot-NN.cuts.json). The old footer showed a single "write the
 * genesis next" line for structure.md regardless of state, which was wrong once
 * Genesis existed. This derives a state-aware line per selected file.
 */
export interface PreviewFooterContext {
  /** Selected file basename, e.g. "structure.md" | "genesis.md" | "plot-01.md". */
  fileName: string;
  contentType: "fiction" | "cartoon";
  /** Whether the story already has a genesis.md. */
  hasGenesis: boolean;
  /** Whether the selected file is already published on-chain. */
  isPublished: boolean;
  /**
   * Cut count for the selected episode file (Genesis or a plot), from its
   * cuts.json. null when the file isn't an episode or its cuts are unknown.
   */
  cutCount: number | null;
  /**
   * Full production progress for a GENESIS episode, so the footer's next-step
   * line tracks the real stage — clean art → lettering → export → upload (#451)
   * — instead of saying "generate clean images" whenever nothing is uploaded.
   * Null for plots (their stage guidance is the CartoonStepGuide) or when unknown.
   */
  cutProgress?: CartoonCutProgress | null;
}

const FICTION_OUTLINE_GUIDANCE = "This is your story outline — not publishable. Ask AI to write the genesis next.";

/**
 * State-aware guidance for the preview footer (#422). Returns the line to show,
 * or null to let the existing per-stage UI speak instead. Fiction is unchanged:
 * structure.md keeps its original outline line and no other file is annotated.
 */
export function previewFooterGuidance(ctx: PreviewFooterContext): string | null {
  const { fileName, contentType, hasGenesis, isPublished, cutCount, cutProgress } = ctx;
  const isStructure = fileName === "structure.md";
  const isGenesis = fileName === "genesis.md";
  const isPlot = /^plot-\d+\.md$/.test(fileName);

  if (isStructure) {
    if (contentType !== "cartoon") return FICTION_OUTLINE_GUIDANCE;
    return hasGenesis
      ? "Your story outline is set. Genesis (Episode 1) already exists — review its opening and cuts; you don't need to write the Genesis again."
      : "This is your story outline — not publishable. Write the Genesis opening (Episode 1) next.";
  }

  // Cartoon episode files, pre-publish only. Published/ready files are handled
  // by the publish controls and per-stage callouts, so don't annotate them.
  if (contentType === "cartoon" && !isPublished && (isGenesis || isPlot) && cutCount !== null) {
    if (cutCount === 0) {
      return isGenesis
        ? "Genesis is your Episode 1 opening. Plan its cuts, then generate clean images for them."
        : "This episode hasn't been started — expand its cut plan before preparing it for publish.";
    }
    // Genesis: track the real production stage so the line advances past
    // "generate clean images" once the clean art exists (#451). Clean art →
    // lettering → export → upload → publish, worded so each is distinct.
    if (isGenesis && cutProgress) {
      const p = cutProgress;
      if (p.withClean < p.needClean) {
        return "Genesis has a cut plan — generate the clean images for its cuts next.";
      }
      if (p.withText < p.total) {
        return "Genesis clean art is ready — review the cuts and add speech bubbles & captions next.";
      }
      if (p.exported < p.total) {
        return "Genesis lettering is underway — export the final images next.";
      }
      if (p.uploaded < p.total) {
        return "Genesis final images are exported — upload them next, then prepare to publish.";
      }
      // Every cut uploaded → the publish controls speak.
    }
  }

  return null;
}

/**
 * Two-axis publish verdict for cartoon markdown (#421). The pilot showed a
 * confusing mix of a green "Readiness: Ready to publish" line next to raw
 * validator warnings. Split the concepts a writer actually needs:
 *
 * - `possible` — the HARD blocker axis: can this publish at all? Mirrors the
 *   publish gate exactly (only a fully-ready episode is publishable).
 * - `recommended` — the SOFT axis: is publishing advisable right now, or does
 *   the content look like planning/placeholder text?
 *
 * Plus a concise, user-facing headline / detail / suggested action — the raw
 * validator strings stay available separately as collapsible technical details.
 */
export interface CartoonPublishVerdict {
  possible: boolean;
  recommended: boolean;
  tone: "ok" | "info" | "warning" | "blocker";
  /** Concise user-facing status, e.g. "Not recommended yet". */
  headline: string;
  /** One short line explaining the state in plain language. */
  detail: string;
  /** Suggested next action, or null when none applies (already publishable). */
  action: string | null;
}

export function cartoonPublishVerdict(input: {
  stage: CartoonReadinessStage | null;
  imageCount: number;
  hasNonImageProse: boolean;
}): CartoonPublishVerdict {
  const { stage, imageCount, hasNonImageProse } = input;

  if (stage === "ready") {
    return {
      possible: true, recommended: true, tone: "ok",
      headline: "Ready to publish",
      detail: "Every cut has an uploaded final image.",
      action: null,
    };
  }

  // Placeholder / planning text: no images and the page is prose. This is the
  // pilot's plot-NN.md "Episode 2 placeholder" — never label it ready, and frame
  // it as a recommendation rather than a wall of validator errors (#421).
  if (imageCount === 0 && hasNonImageProse) {
    return {
      possible: false, recommended: false, tone: "warning",
      headline: "Not recommended yet — this looks like planning/placeholder text",
      detail: "There are no images and the page is prose, so it reads as planning notes, not a finished episode.",
      action: "Prepare episode for publish after final images are uploaded.",
    };
  }

  switch (stage) {
    case "not-started":
      return {
        possible: false, recommended: false, tone: "info",
        headline: "Not started",
        detail: "This episode has no cuts planned yet.",
        action: "Plan its cuts, then create and upload images.",
      };
    case "planning":
      return {
        possible: false, recommended: false, tone: "info",
        headline: "Not ready yet — prepare for publish",
        detail: "The cut plan is set, but the publish layout isn't built yet.",
        action: "Prepare the episode for publish.",
      };
    case "awaiting-upload":
      return {
        possible: false, recommended: false, tone: "info",
        headline: "Waiting on image uploads",
        detail: "Some cuts still need a final uploaded image.",
        action: "Upload the remaining final images, then publish.",
      };
    case "error":
      return {
        possible: false, recommended: false, tone: "blocker",
        headline: "Not publishable — needs fixes",
        detail: "Some cuts have problems that must be fixed before publishing.",
        action: "Open the technical details below to see what to fix.",
      };
    default:
      return {
        possible: false, recommended: false, tone: "info",
        headline: "Checking readiness…",
        detail: "",
        action: null,
      };
  }
}
