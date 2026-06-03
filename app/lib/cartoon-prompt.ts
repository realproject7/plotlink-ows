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
 * agent to PRODUCE THE ACTUAL IMAGE and hand it off to the cut. A generated PNG in
 * the image cache is an accepted outcome: the agent must NOT convert it (no
 * agent-side image tools) — the writer imports it via the OWS "Import from Codex"
 * button, which converts it. A tool that already emits WebP/JPEG <1MB can write the
 * asset path directly. The visual prompt is embedded so no scene detail is lost.
 * Pure function — no side effects.
 */
export function buildCodexTaskPrompt(cut: Cut, plotFile: string): string {
  const outputPath = cleanImageOutputPath(plotFile, cut.id);
  return [
    `Generate the clean image for cut ${cut.id}.`,
    "",
    "Image description:",
    buildCleanImagePrompt(cut),
    "",
    "How to hand it off:",
    "- Produce the actual image — do not just describe it or return a prompt.",
    `- If your image tool can write a WebP or JPEG under 1MB, save it at ${outputPath} and run "Sync clean images".`,
    "- If it only produces a PNG (e.g. built-in image generation saves to ~/.codex/generated_images), that is fine — do NOT convert or rename it yourself. Leave it there and import it into this cut with the OWS \"Import from Codex\" button, which converts the PNG automatically.",
    "- Clean image only: no text, speech bubbles, captions, sound effects, signage, watermark, or signature.",
    "- Do not letter or upload anything — final lettering and upload happen later in OWS.",
  ].join("\n");
}
