// Per-cut lettering status + "insert from script" helpers for the cartoon
// lettering editor guidance (#336). Pure and UI-agnostic so they can be unit
// tested and shared between the editor checklist and the insert-from-script
// panel. None of this changes the export model or publish readiness rules.

import type { Overlay } from "./overlays";

/** The cut fields the lettering guidance reads (a structural subset of Cut). */
export interface LetteringCut {
  cleanImagePath?: string | null;
  finalImagePath?: string | null;
  exportedAt?: string | null;
  uploadedUrl?: string | null;
  uploadedCid?: string | null;
  narration?: string;
  sfx?: string;
  dialogue?: { speaker: string; text: string }[];
  overlays?: Overlay[];
}

export interface LetteringChecklist {
  /** A clean (text-free) image has been recorded for the cut. */
  hasCleanImage: boolean;
  /** The cut plan carries script text (dialogue, narration, or SFX) to letter. */
  hasScriptText: boolean;
  /** How many overlays (bubbles/captions/SFX) have been placed. */
  bubblesPlaced: number;
  /** A final lettered image has been exported. */
  exported: boolean;
  /** An uploaded URL/CID is recorded for the cut. */
  uploaded: boolean;
}

/**
 * Summarize a single cut's lettering progress for the editor's status strip
 * (#336): clean image present → script text available → bubbles placed →
 * exported → uploaded. Read-only; derived straight from the cut record.
 */
export function cutLetteringChecklist(cut: LetteringCut): LetteringChecklist {
  return {
    hasCleanImage: !!cut.cleanImagePath,
    hasScriptText:
      (cut.dialogue?.length ?? 0) > 0 || !!cut.narration?.trim() || !!cut.sfx?.trim(),
    bubblesPlaced: cut.overlays?.length ?? 0,
    exported: !!cut.finalImagePath || !!cut.exportedAt,
    uploaded: !!cut.uploadedUrl || !!cut.uploadedCid,
  };
}

export type ScriptLineType = "speech" | "narration" | "sfx";

/** A piece of the cut's script the writer can drop straight into an overlay. */
export interface ScriptLine {
  type: ScriptLineType;
  /** Speaker for a dialogue line; undefined for narration/SFX. */
  speaker?: string;
  text: string;
  /** Stable key for list rendering / dedupe (type + index within its kind). */
  key: string;
}

/**
 * Flatten a cut's `cuts.json` script (dialogue lines, narration, SFX) into the
 * ordered list the editor offers as one-click "insert into a bubble" actions
 * (#336) — so a writer never has to hand-copy text out of the JSON. Empty
 * pieces are skipped.
 */
export function cutScriptLines(cut: LetteringCut): ScriptLine[] {
  const lines: ScriptLine[] = [];
  (cut.dialogue ?? []).forEach((d, i) => {
    if (d?.text?.trim()) {
      lines.push({ type: "speech", speaker: d.speaker, text: d.text.trim(), key: `speech-${i}` });
    }
  });
  if (cut.narration?.trim()) {
    lines.push({ type: "narration", text: cut.narration.trim(), key: "narration" });
  }
  if (cut.sfx?.trim()) {
    lines.push({ type: "sfx", text: cut.sfx.trim(), key: "sfx" });
  }
  return lines;
}
