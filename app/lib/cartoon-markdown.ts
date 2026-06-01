import type { Cut } from "./cuts";
import { findPlaceholderProse } from "./cartoon-readiness";

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
 * Drop non-marker paragraphs that are pre-generation / instructional placeholder
 * prose, so generated publish markdown stays image-only (plus marker comments).
 * Paragraphs are blank-line-delimited; a `ows:cartoon-cut` block is a single
 * paragraph (its lines are joined by single newlines) and is always preserved.
 * See #286 — the leaked "Placeholder only ..." line was such a stray paragraph.
 */
function stripPlaceholderProse(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .filter((para) => para.includes("ows:cartoon-cut") || !findPlaceholderProse(para))
    .join("\n\n");
}

export function mergeCartoonMarkdown(
  existingMd: string,
  cuts: Cut[],
): { markdown: string; warnings: string[] } {
  const warnings: string[] = [];

  existingMd = stripPlaceholderProse(existingMd);

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
