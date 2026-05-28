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

  // Defense in depth: any image ref anywhere must be an http(s) URL (no local
  // asset paths or relative refs), even outside recognized cut blocks.
  const allRefs = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)];
  for (const ref of allRefs) {
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
