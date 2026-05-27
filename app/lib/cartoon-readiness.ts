import type { Cut } from "./cuts";

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

export function checkMarkdownReadiness(
  markdown: string,
  cuts: Cut[],
): { ready: boolean; issues: string[] } {
  const issues: string[] = [];

  for (let i = 0; i < cuts.length; i++) {
    const id = `cut-${String(i + 1).padStart(3, "0")}`;
    const hasStart = markdown.includes(`<!-- ows:cartoon-cut ${id} start -->`);
    const hasEnd = markdown.includes(`<!-- ows:cartoon-cut ${id} end -->`);
    if (!hasStart || !hasEnd) {
      issues.push(`Cut ${i + 1}: missing or incomplete markdown block`);
    }
  }

  if (markdown.includes("awaiting upload")) {
    issues.push("Markdown contains awaiting-upload placeholders");
  }

  if (markdown.length > 10000) {
    issues.push(`Markdown is ${markdown.length} chars (limit 10,000)`);
  }

  return { ready: issues.length === 0, issues };
}
