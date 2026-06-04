import type { Cut } from "./cuts";
import { cutScriptLines } from "./lettering-status";

const SHOT_TYPE_LABELS: Record<string, string> = {
  wide: "Wide",
  medium: "Medium",
  "close-up": "Close-up",
  "extreme-close-up": "Extreme close-up",
};

const NO_TEXT_CONSTRAINT =
  "No speech bubbles, captions, sound effects, narration, or any text or lettering in the image.";

/**
 * Baseline visual style lock for every clean cut image (#404).
 *
 * Image generation drifts toward polished photoreal / painterly concept art unless
 * the prompt fights it explicitly — "semi-realistic webtoon" alone is too weak (it
 * was the #211 Sci-fi pilot's failure mode). This block pins the requested
 * illustrated-panel look with strong positive descriptors AND hard negative
 * constraints (no photorealism, no painterly concept art, no 3D render), so it is
 * reusable across every cut and the agent-facing "Copy Codex task" prompt without
 * each cut re-stating it. Story-specific style (palette, line weight, the exact
 * webtoon reference) is layered on top via structure.md's Visual Style Guide.
 */
export const CLEAN_IMAGE_STYLE_LOCK =
  "Style lock — illustrated comic/webtoon panel art: clean black contour/ink lines, " +
  "flat or cel shading, simplified but realistic (semi-realistic) anatomy and faces, " +
  "backgrounds drawn as illustrated comic panels. Hold this same style on every cut for " +
  "character and panel consistency. " +
  "Hard negatives — NOT photorealistic, NOT a photograph, NOT a glossy or painterly digital " +
  "painting, NOT concept art, NOT a 3D/CGI render, NOT airbrushed, no photoreal textures.";

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

  lines.push(CLEAN_IMAGE_STYLE_LOCK);
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
    "- Hold the style lock above — an illustrated comic/webtoon panel, NOT a photoreal photo, painterly concept art, or 3D render. If a result reads photorealistic, regenerate it as illustrated panel art.",
    "- Do not letter or upload anything — final lettering and upload happen later in OWS.",
  ].join("\n");
}

/**
 * Build the "Ask AI to draft lettering" prompt for a cut (#442). The agent writes
 * DRAFT speech bubbles/captions into the cut's `overlays` array in cuts.json from
 * the recorded script; the writer then reviews/adjusts them in the OWS lettering
 * editor and exports there. Intentionally a copy-paste prompt — no auto-apply, no
 * export/upload — so the human stays in control of the final lettering. Pure.
 */
export function buildLetteringPrompt(cut: Cut, plotFile: string): string {
  const cutsFile = `${plotFile}.cuts.json`;
  const lines = cutScriptLines(cut);
  const script = lines.length > 0
    ? lines
        .map((l) =>
          l.type === "speech"
            ? `- speech — ${l.speaker || "Speaker"}: "${l.text}"`
            : l.type === "narration"
              ? `- narration: ${l.text}`
              : `- sfx: ${l.text}`,
        )
        .join("\n")
    : "- (no dialogue/narration/SFX recorded for this cut — add a caption only if the scene needs one)";
  return [
    `Draft the speech bubbles and captions for cut ${cut.id} of ${plotFile}.`,
    "",
    "Script to letter:",
    script,
    "",
    "How to draft it:",
    `- Edit cut ${cut.id}'s "overlays" array in ${cutsFile}: add one overlay per line above — "type":"speech" for dialogue (also set "speaker"), "narration" for captions, "sfx" for sound effects, with the line's text.`,
    "- Position each overlay with x, y, width, height as 0–1 fractions of the panel, roughly where it belongs over the art, and keep bubbles clear of faces.",
    "- These are DRAFT positions only: do NOT export or upload. The writer reviews and adjusts them in the OWS lettering editor, then exports the final image there.",
  ].join("\n");
}
