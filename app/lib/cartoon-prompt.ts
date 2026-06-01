import type { Cut } from "./cuts";

const SHOT_TYPE_LABELS: Record<string, string> = {
  wide: "Wide",
  medium: "Medium",
  "close-up": "Close-up",
  "extreme-close-up": "Extreme close-up",
};

const NO_TEXT_CONSTRAINT =
  "No speech bubbles, captions, sound effects, narration, or any text or lettering in the image.";

/**
 * Build a deterministic clean-image generation prompt from a cut's fields only.
 *
 * Pure function — no side effects. Dialogue, narration, and SFX text are
 * intentionally excluded: those are lettered onto the image later, not drawn.
 */
export function buildCleanImagePrompt(cut: Cut): string {
  const shotLabel = SHOT_TYPE_LABELS[cut.shotType] ?? cut.shotType;
  const description = cut.description?.trim() || `Cut ${cut.id}`;

  const lines: string[] = [`${shotLabel} shot. ${description}`];

  if (cut.characters.length > 0) {
    lines.push(`Characters: ${cut.characters.join(", ")}.`);
  }

  lines.push(NO_TEXT_CONSTRAINT);

  return lines.join("\n").trim();
}

/** Canonical clean-image output path for a cut (webp, matching the sync/import contract). */
export function cleanImageOutputPath(plotFile: string, cutId: number): string {
  return `assets/${plotFile}/cut-${String(cutId).padStart(2, "0")}-clean.webp`;
}

/**
 * Build an actionable Codex *task* prompt for generating a cut's clean image.
 *
 * Unlike `buildCleanImagePrompt` (a pure visual description), this instructs the
 * agent to CREATE THE ACTUAL FILE at the exact target path and verify it before
 * reporting success — so Codex produces a real `cut-XX-clean.webp` asset rather
 * than returning a prompt or description. The visual prompt is embedded so no
 * scene detail is lost. Pure function — no side effects.
 */
export function buildCodexTaskPrompt(cut: Cut, plotFile: string): string {
  const outputPath = cleanImageOutputPath(plotFile, cut.id);
  return [
    `Generate the clean image for cut ${cut.id} and SAVE IT AS AN ACTUAL FILE at: ${outputPath}`,
    "",
    "Image description:",
    buildCleanImagePrompt(cut),
    "",
    "Requirements:",
    `- Create the real image file at ${outputPath} — do not just describe it or return a prompt.`,
    "- Clean image only: no text, speech bubbles, captions, sound effects, signage, watermark, or signature.",
    "- Format: WebP (or JPEG). Size: under 1MB.",
    `- After saving, VERIFY the file exists at ${outputPath} before reporting success. Do not claim success unless the file is actually written.`,
    "- Do not letter or upload anything — final lettering and upload happen later in OWS.",
  ].join("\n");
}
