import fs from "fs";
import path from "path";
import { hasVisibleSpeechTail, CARTOON_BUBBLE_RENDERER_VERSION, type Overlay } from "./overlays";

export const SHOT_TYPES = ["wide", "medium", "close-up", "extreme-close-up"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export interface CutDialogue {
  speaker: string;
  text: string;
}

/**
 * Panel kind (#350). An "image" cut is the normal art panel (needs a clean
 * image → lettering → export → upload). A "text" panel is a text/interstitial
 * card (no clean image; text on a styled background, still exported + uploaded
 * as a final image for MVP). The field is OPTIONAL and backward-compatible:
 * a missing `kind` means "image".
 */
export type CutKind = "image" | "text";

export interface Cut {
  id: number;
  shotType: ShotType;
  description: string;
  characters: string[];
  dialogue: CutDialogue[];
  narration: string;
  sfx: string;
  cleanImagePath: string | null;
  finalImagePath: string | null;
  exportedAt: string | null;
  uploadedCid: string | null;
  uploadedUrl: string | null;
  overlays: Overlay[];
  /**
   * Bubble-renderer revision the final image was exported with (#381). Absent on
   * cuts exported before versioning (treated as stale for tailed bubbles). Stamped
   * by the export-final endpoint with CARTOON_BUBBLE_RENDERER_VERSION.
   */
  finalRendererVersion?: number;
  /** Panel kind (#350). Absent ⇒ "image" (backward-compatible). */
  kind?: CutKind;
  /** Text-panel background color (CSS color), e.g. "#101820". Optional (#350). */
  background?: string;
  /** Text-panel aspect ratio hint, e.g. "4:5". Optional (#350). */
  aspectRatio?: string;
}

/** Whether a cut is a text/interstitial panel (#350); missing kind ⇒ image. */
export function isTextPanel(cut: Pick<Cut, "kind">): boolean {
  return cut.kind === "text";
}

/**
 * Whether a cut's exported final image is STALE for #381: it has a final image
 * AND renders at least one visible speech-bubble tail AND was exported by an
 * older bubble renderer (its `finalRendererVersion` is absent — pre-versioning —
 * or below `currentVersion`). Such an image may show the old separate-tail seam
 * and must be re-exported before publish. Tailless cuts are never stale (the
 * seam fixes only affect tailed bubbles), so existing exports aren't churned.
 */
export function isStaleTailedExport(
  cut: Pick<Cut, "finalImagePath" | "finalRendererVersion" | "overlays">,
  currentVersion: number = CARTOON_BUBBLE_RENDERER_VERSION,
): boolean {
  if (!cut.finalImagePath) return false;
  const tailed = (cut.overlays ?? []).some(hasVisibleSpeechTail);
  if (!tailed) return false;
  return (cut.finalRendererVersion ?? 0) < currentVersion;
}

/** Ids of cuts whose final image is a stale tailed export (#381), in order. */
export function staleTailedCutIds(
  cutsFile: Pick<CutsFile, "cuts">,
  currentVersion: number = CARTOON_BUBBLE_RENDERER_VERSION,
): number[] {
  return cutsFile.cuts.filter((c) => isStaleTailedExport(c, currentVersion)).map((c) => c.id);
}

/** Base canvas width for a text panel sized from its aspect ratio (#351). */
export const TEXT_PANEL_BASE_WIDTH = 800;

/**
 * Canvas dimensions for a text panel from an "W:H" aspect ratio (#351) — shared
 * by the lettering editor (so its surface matches) and the export, so a text
 * panel letters and exports at the SAME shape. Returns null for a missing or
 * malformed ratio; callers fall back to 800×600.
 */
export function textPanelDimensions(aspectRatio: string | undefined): { width: number; height: number } | null {
  if (!aspectRatio) return null;
  const m = aspectRatio.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return { width: TEXT_PANEL_BASE_WIDTH, height: Math.round((TEXT_PANEL_BASE_WIDTH * h) / w) };
}

export interface CutsFile {
  version: 1;
  plotFile: string;
  /**
   * Optional human-readable episode title (#347). When present it becomes the
   * published chapter title for a cartoon episode whose plot-NN.md has no H1
   * (cartoon publish markdown is image-only by design), so the episode never
   * publishes as the raw "plot-NN" filename. Absent in v1 cut plans — callers
   * fall back to a friendly "Episode NN".
   */
  title?: string;
  cuts: Cut[];
}

export function createDefaultCut(id: number, _plotFile: string): Cut {
  return {
    id,
    shotType: "medium",
    description: "",
    characters: [],
    dialogue: [],
    narration: "",
    sfx: "",
    cleanImagePath: null,
    finalImagePath: null,
    exportedAt: null,
    uploadedCid: null,
    uploadedUrl: null,
    overlays: [],
  };
}

export function createCutsFile(plotFile: string, cutCount = 1): CutsFile {
  const cuts = Array.from({ length: cutCount }, (_, i) => createDefaultCut(i + 1, plotFile));
  return { version: 1, plotFile, cuts };
}

function cutsFilePath(storyDir: string, plotFile: string): string {
  return path.join(storyDir, `${plotFile}.cuts.json`);
}

export function readCutsFile(storyDir: string, plotFile: string): CutsFile | null {
  const filePath = cutsFilePath(storyDir, plotFile);
  if (!fs.existsSync(filePath)) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read ${plotFile}.cuts.json: ${(err as Error).message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${plotFile}.cuts.json contains invalid JSON`);
  }

  const validation = validateCutsFile(data);
  if (!validation.valid) {
    throw new Error(`${plotFile}.cuts.json is invalid: ${validation.error}`);
  }

  return data as CutsFile;
}

export function writeCutsFile(storyDir: string, plotFile: string, cutsFile: CutsFile): void {
  const filePath = cutsFilePath(storyDir, plotFile);
  fs.writeFileSync(filePath, JSON.stringify(cutsFile, null, 2) + "\n");
}

export function validateCutsFile(data: unknown): { valid: boolean; error?: string } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { valid: false, error: "Must be a JSON object" };
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    return { valid: false, error: "Unsupported version (expected 1)" };
  }

  if (typeof obj.plotFile !== "string" || !obj.plotFile) {
    return { valid: false, error: "Missing or invalid plotFile" };
  }

  if (!Array.isArray(obj.cuts)) {
    return { valid: false, error: "cuts must be an array" };
  }

  // Optional episode title (#347) — string when present.
  if (obj.title !== undefined && typeof obj.title !== "string") {
    return { valid: false, error: "title must be a string" };
  }

  const validShots = new Set<string>(SHOT_TYPES);

  for (let i = 0; i < obj.cuts.length; i++) {
    const cut = obj.cuts[i] as Record<string, unknown>;
    if (typeof cut !== "object" || cut === null) {
      return { valid: false, error: `Cut ${i} is not an object` };
    }
    if (typeof cut.id !== "number") {
      return { valid: false, error: `Cut ${i} missing numeric id` };
    }
    if (typeof cut.shotType !== "string" || !validShots.has(cut.shotType)) {
      return { valid: false, error: `Cut ${i} has invalid shotType` };
    }
    if (typeof cut.description !== "string") {
      return { valid: false, error: `Cut ${i} missing description` };
    }
    if (!Array.isArray(cut.characters)) {
      return { valid: false, error: `Cut ${i} characters must be an array` };
    }
    for (let j = 0; j < (cut.characters as unknown[]).length; j++) {
      if (typeof (cut.characters as unknown[])[j] !== "string") {
        return { valid: false, error: `Cut ${i} characters[${j}] must be a string` };
      }
    }
    if (!Array.isArray(cut.dialogue)) {
      return { valid: false, error: `Cut ${i} dialogue must be an array` };
    }
    for (let j = 0; j < (cut.dialogue as unknown[]).length; j++) {
      const d = (cut.dialogue as Record<string, unknown>[])[j];
      if (typeof d !== "object" || d === null || typeof d.speaker !== "string" || typeof d.text !== "string") {
        return { valid: false, error: `Cut ${i} dialogue[${j}] must have speaker and text strings` };
      }
    }
    if (typeof cut.narration !== "string") {
      return { valid: false, error: `Cut ${i} missing narration` };
    }
    if (typeof cut.sfx !== "string") {
      return { valid: false, error: `Cut ${i} missing sfx` };
    }
    const nullableStrings = ["cleanImagePath", "finalImagePath", "exportedAt", "uploadedCid", "uploadedUrl"] as const;
    for (const field of nullableStrings) {
      if (cut[field] !== null && typeof cut[field] !== "string") {
        return { valid: false, error: `Cut ${i} ${field} must be a string or null` };
      }
    }
    if (cut.overlays !== undefined && !Array.isArray(cut.overlays)) {
      return { valid: false, error: `Cut ${i} overlays must be an array` };
    }
    // Text-panel fields (#350) — all optional and backward-compatible.
    if (cut.kind !== undefined && cut.kind !== "image" && cut.kind !== "text") {
      return { valid: false, error: `Cut ${i} kind must be "image" or "text"` };
    }
    if (cut.background !== undefined && typeof cut.background !== "string") {
      return { valid: false, error: `Cut ${i} background must be a string` };
    }
    if (cut.aspectRatio !== undefined && typeof cut.aspectRatio !== "string") {
      return { valid: false, error: `Cut ${i} aspectRatio must be a string` };
    }
    // Bubble-renderer version stamp (#381) — optional, backward-compatible
    // (absent ⇒ pre-versioning final image).
    if (cut.finalRendererVersion !== undefined && typeof cut.finalRendererVersion !== "number") {
      return { valid: false, error: `Cut ${i} finalRendererVersion must be a number` };
    }
  }

  return { valid: true };
}
