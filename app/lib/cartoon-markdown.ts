import type { Cut } from "./cuts";

const MARKER_START = (id: string) => `<!-- ows:cartoon-cut ${id} start -->`;
const MARKER_END = (id: string) => `<!-- ows:cartoon-cut ${id} end -->`;
const MARKER_REGEX = /<!-- ows:cartoon-cut (cut-\d+) start -->\n[\s\S]*?<!-- ows:cartoon-cut \1 end -->/g;

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
 * Reduce the markdown to ONLY its `ows:cartoon-cut` marker blocks, dropping every
 * other paragraph. Publish-facing cartoon markdown is a pure image sequence, so
 * any non-marker prose — scaffold instructions, stale placeholders, manual
 * commentary, headings — must not survive into it (#319). Earlier we stripped
 * only a known-placeholder allowlist (#286), but the #211 pilot still leaked
 * instructional prose that fell outside those patterns and forced a manual
 * rewrite; dropping all non-marker paragraphs removes that whole class of leak.
 * Paragraphs are blank-line-delimited; a cut block's lines are joined by single
 * newlines, so each block is one paragraph and is preserved intact.
 */
function stripNonMarkerProse(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .filter((para) => para.includes("ows:cartoon-cut"))
    .join("\n\n");
}

export function mergeCartoonMarkdown(
  existingMd: string,
  cuts: Cut[],
): { markdown: string; warnings: string[] } {
  const warnings: string[] = [];

  // Only rewrite to a pure image sequence for an actual cartoon document — one
  // with cuts to publish or existing cut markers. A markerless doc with no cuts
  // is fiction (the route guards on cuts.json, but keep the function safe too),
  // so leave it untouched.
  const isCartoonDoc = cuts.length > 0 || /ows:cartoon-cut/.test(existingMd);
  if (isCartoonDoc) existingMd = stripNonMarkerProse(existingMd);

  const newBlocks = new Map<string, string>();
  for (let i = 0; i < cuts.length; i++) {
    const id = cutId(i + 1);
    newBlocks.set(id, generateCutBlock(cuts[i], i + 1));

    if (!cuts[i].uploadedUrl) {
      warnings.push(`Cut ${i + 1}: missing upload URL`);
    }
  }

  const existingIds = new Set<string>();
  const merged = existingMd.replace(MARKER_REGEX, (match, id: string) => {
    existingIds.add(id);
    if (newBlocks.has(id)) {
      const block = newBlocks.get(id)!;
      newBlocks.delete(id);
      return block;
    }
    warnings.push(`Removed stale block: ${id}`);
    return "";
  });

  let result = merged.replace(/\n{3,}/g, "\n\n").trim();

  if (newBlocks.size > 0) {
    const appended = Array.from(newBlocks.values()).join("\n\n");
    result = result ? `${result}\n\n${appended}` : appended;
  }

  return { markdown: result, warnings };
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
