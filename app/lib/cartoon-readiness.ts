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

  if (/awaiting upload|image pending|final image pending|pending upload/i.test(markdown)) {
    issues.push("Markdown contains awaiting-upload placeholders");
  }

  // Image references must use uploaded http(s)/IPFS URLs — never local asset paths.
  const imageRefs = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)];
  for (const ref of imageRefs) {
    const url = ref[1].trim();
    if (!/^https?:\/\//i.test(url)) {
      issues.push(`Invalid image reference (not an uploaded URL): ${url.slice(0, 60)}`);
    }
  }

  if (markdown.length > 10000) {
    issues.push(`Markdown is ${markdown.length} chars (limit 10,000)`);
  }

  return { ready: issues.length === 0, issues };
}
