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

export type CartoonStage = "planning" | "awaiting-upload" | "error" | "ready";

export interface CartoonClassification {
  stage: CartoonStage;
  issues: string[];
  awaitingCount: number;
  totalCuts: number;
}

const IMAGE_REF_RE = /!\[[^\]]*\]\([^)]*\)/;

/**
 * Classify cartoon publish readiness, distinguishing the intentional
 * "awaiting-upload" skeleton state (calm/pending — the user just ran Generate
 * MD and now needs to generate/letter/export/upload images) from genuinely
 * malformed markdown (red/actionable errors). The underlying
 * `checkMarkdownReadiness` gate is left unchanged so the server publish path
 * keeps blocking awaiting-upload markdown.
 */
export function classifyCartoonReadiness(
  markdown: string,
  cuts: Cut[],
): CartoonClassification {
  const totalCuts = cuts.length;

  if (isCartoonPlanningStage(markdown, cuts)) {
    return { stage: "planning", issues: [], awaitingCount: 0, totalCuts };
  }

  const { ready, issues } = checkMarkdownReadiness(markdown, cuts);
  if (ready) {
    return { stage: "ready", issues: [], awaitingCount: 0, totalCuts };
  }

  // An "awaiting" cut has its marker block present but no image reference yet,
  // and no recorded uploadedUrl — i.e. the intentional skeleton placeholder.
  const awaitingLabels: string[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const id = `cut-${String(i + 1).padStart(3, "0")}`;
    const block = extractCutBlock(markdown, id);
    if (block === null) continue;
    if (IMAGE_REF_RE.test(block)) continue;
    if (cut.uploadedUrl) continue;
    awaitingLabels.push(`Cut ${i + 1}`);
  }
  const awaitingCount = awaitingLabels.length;

  // Strip the expected awaiting-upload noise; whatever remains is a real error.
  const expectedNoise = new Set<string>([
    "Markdown contains awaiting-upload placeholders",
  ]);
  for (const label of awaitingLabels) {
    expectedNoise.add(`${label}: not uploaded (no recorded uploaded URL)`);
    expectedNoise.add(`${label}: block has no image reference`);
  }
  const realIssues = issues.filter((issue) => !expectedNoise.has(issue));

  if (realIssues.length > 0) {
    return { stage: "error", issues: realIssues, awaitingCount, totalCuts };
  }

  return { stage: "awaiting-upload", issues: [], awaitingCount, totalCuts };
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
