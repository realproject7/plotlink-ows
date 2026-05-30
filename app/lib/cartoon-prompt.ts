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
