import type { Cut } from "./cuts";

const MARKER_START = (id: string) => `<!-- ows:cartoon-cut ${id} start -->`;
const MARKER_END = (id: string) => `<!-- ows:cartoon-cut ${id} end -->`;
// Matches each existing cut-block START marker (capturing its id), used only to
// report stale blocks — blocks that existed but no longer map to a cut.
const START_MARKER_REGEX = /<!-- ows:cartoon-cut (cut-\d+) start -->/g;

function cutId(index: number): string {
  return `cut-${String(index).padStart(3, "0")}`;
}

export function generateCutBlock(cut: Cut, index: number): string {
  const id = cutId(index);
  const desc = cut.description || `Cut ${index}`;

  // Every cut is a planned image cut. The publish-facing markdown only carries
  // the uploaded image once it exists; before that we emit a safe awaiting-upload
  // marker comment. We never copy dialogue/narration prose from cuts.json into
  // the skeleton — those texts are lettered onto the image, not published as text.
  const content = cut.uploadedUrl
    ? `![${desc}](${cut.uploadedUrl})`
    : `<!-- Cut ${index}: awaiting upload -->`;

  return `${MARKER_START(id)}\n${content}\n${MARKER_END(id)}`;
}

export function generateCartoonMarkdown(cuts: Cut[]): string {
  return cuts.map((cut, i) => generateCutBlock(cut, i + 1)).join("\n\n");
}

/**
 * Generate the publish-facing cartoon markdown for a plot from its cut plan.
 *
 * Publish-facing cartoon markdown is a PURE `ows:cartoon-cut` image sequence, so
 * the output is rebuilt entirely from `cuts` rather than edited in place: no
 * surrounding prose from `existingMd` — scaffold instructions, stale placeholders,
 * headings, manual commentary — can survive into it (#319). Rebuilding (rather
 * than the earlier strip-and-replace) also closes the case @re1 flagged where
 * prose sat in the same blank-line paragraph as a marker block (e.g.
 * `Intro\n<!-- ...start -->\n…\n<!-- ...end -->\nOutro`) and leaked through a
 * block-only regex replace.
 *
 * `existingMd` is consulted only to (a) leave a non-cartoon document — markerless
 * and with no cuts, i.e. fiction — untouched, and (b) report cut blocks that
 * existed before but no longer map to a cut ("stale" blocks).
 */
export function mergeCartoonMarkdown(
  existingMd: string,
  cuts: Cut[],
): { markdown: string; warnings: string[] } {
  const warnings: string[] = [];

  // A markerless doc with no cuts is fiction — leave it untouched. (The route
  // already guards on cuts.json, but keep the function safe in isolation.)
  const isCartoonDoc = cuts.length > 0 || /ows:cartoon-cut/.test(existingMd);
  if (!isCartoonDoc) return { markdown: existingMd, warnings };

  for (let i = 0; i < cuts.length; i++) {
    if (!cuts[i].uploadedUrl) {
      warnings.push(`Cut ${i + 1}: missing upload URL`);
    }
  }

  // Warn about cut marker blocks present in the old markdown that no longer map
  // to a cut, so a removed/renumbered cut is not silently dropped.
  const newIds = new Set<string>(cuts.map((_, i) => cutId(i + 1)));
  for (const m of existingMd.matchAll(START_MARKER_REGEX)) {
    if (!newIds.has(m[1])) warnings.push(`Removed stale block: ${m[1]}`);
  }

  return { markdown: generateCartoonMarkdown(cuts), warnings };
}

export function getReadinessWarnings(cuts: Cut[]): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < cuts.length; i++) {
    if (!cuts[i].uploadedUrl) {
      warnings.push(`Cut ${i + 1}: not uploaded`);
    }
  }
  return warnings;
}
