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

  let content: string;
  if (cut.uploadedUrl) {
    content = `![${desc}](${cut.uploadedUrl})`;
  } else if (cut.cleanImagePath || cut.finalImagePath) {
    content = `<!-- Cut ${index}: awaiting upload -->`;
  } else if (!cut.cleanImagePath && !cut.finalImagePath) {
    const lines: string[] = [];
    if (cut.dialogue.length > 0) {
      for (const d of cut.dialogue) {
        lines.push(`**${d.speaker}:** ${d.text}`);
      }
    }
    if (cut.narration) {
      lines.push(`*${cut.narration}*`);
    }
    content = lines.length > 0 ? lines.join("\n\n") : `*[Narration cut ${index}]*`;
  }

  return `${MARKER_START(id)}\n${content}\n${MARKER_END(id)}`;
}

export function generateCartoonMarkdown(cuts: Cut[]): string {
  return cuts.map((cut, i) => generateCutBlock(cut, i + 1)).join("\n\n");
}

export function mergeCartoonMarkdown(
  existingMd: string,
  cuts: Cut[],
): { markdown: string; warnings: string[] } {
  const warnings: string[] = [];

  const newBlocks = new Map<string, string>();
  for (let i = 0; i < cuts.length; i++) {
    const id = cutId(i + 1);
    newBlocks.set(id, generateCutBlock(cuts[i], i + 1));

    if (!cuts[i].uploadedUrl && (cuts[i].cleanImagePath || cuts[i].finalImagePath)) {
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
