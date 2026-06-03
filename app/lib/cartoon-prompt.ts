import type { Cut } from "./cuts";

const SHOT_TYPE_LABELS: Record<string, string> = {
  wide: "Wide",
  medium: "Medium",
  "close-up": "Close-up",
  "extreme-close-up": "Extreme close-up",
};

const NO_TEXT_CONSTRAINT =
  "No speech bubbles, captions, sound effects, narration, or any text or lettering in the image.";

const WEBTOON_STYLE_LOCK =
  "Style lock: illustrated Korean vertical webtoon panel, clean black contour lines, semi-realistic stylized characters, flat/cel shading with simple soft shadows, readable panel composition. Avoid photorealistic photo, 3D render, painterly concept art, cinematic concept art, hyperreal skin texture, and glossy AI-photo lighting.";

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

  lines.push(WEBTOON_STYLE_LOCK);
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
 * agent to produce real image output. If Codex can write the canonical OWS WebP
 * directly, it should. If image generation lands in `~/.codex/generated_images`
 * as a PNG cache file, that is also acceptable: the writer imports it through
 * the OWS "Import from Codex" picker, which converts/compresses it through the
 * existing upload path. Pure function — no side effects.
 */
export function buildCodexTaskPrompt(cut: Cut, plotFile: string): string {
  const outputPath = cleanImageOutputPath(plotFile, cut.id);
  return [
    `Generate the clean image for cut ${cut.id}. Preferred OWS path if you can write it directly: ${outputPath}`,
    "",
    "Image description:",
    buildCleanImagePrompt(cut),
    "",
    "Requirements:",
    "- Create real image output — do not just describe it or return a prompt.",
    `- If you can save a compliant WebP/JPEG directly, save it at ${outputPath}.`,
    "- If Codex image generation saves a PNG in ~/.codex/generated_images instead, that is acceptable. Do not convert it in the terminal. Report the cache image path/name and continue generating the remaining requested cuts.",
    "- The writer will use OWS “Import from Codex” on this cut to convert/compress the cached PNG through the existing upload path.",
    "- Clean image only: no text, speech bubbles, captions, sound effects, signage, watermark, or signature.",
    "- Keep the webtoon style lock; avoid photorealistic, 3D, painterly, cinematic, or hyperreal output.",
    `- Only claim the OWS asset was saved if the file actually exists at ${outputPath}. Otherwise report the Codex cache file for OWS import.`,
    "- Do not letter or upload anything — final lettering and upload happen later in OWS.",
  ].join("\n");
}
