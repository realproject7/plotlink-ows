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
 *
 * `opts.staleExport` (#336, re1): when the writer has edited the overlays since
 * the recorded export, the existing final image / uploaded URL no longer match
 * what's on screen, so export & upload are reported as NOT done — the writer
 * must re-export before those steps count again.
 */
export function cutLetteringChecklist(
  cut: LetteringCut,
  opts: { staleExport?: boolean } = {},
): LetteringChecklist {
  const exported = !opts.staleExport && (!!cut.finalImagePath || !!cut.exportedAt);
  const uploaded = !opts.staleExport && (!!cut.uploadedUrl || !!cut.uploadedCid);
  return {
    hasCleanImage: !!cut.cleanImagePath,
    hasScriptText:
      (cut.dialogue?.length ?? 0) > 0 || !!cut.narration?.trim() || !!cut.sfx?.trim(),
    bubblesPlaced: cut.overlays?.length ?? 0,
    exported,
    uploaded,
  };
}

/**
 * Stable signature of an overlay set for change detection (#336). Captures only
 * the fields that affect the rendered/exported image (type, geometry, text,
 * speaker, tail), so reordering of unrelated metadata doesn't matter and any
 * real edit changes the signature.
 */
export function overlaysSignature(overlays: Overlay[] | undefined): string {
  return JSON.stringify(
    (overlays ?? []).map((o) => [o.type, o.x, o.y, o.width, o.height, o.text, o.speaker ?? "", o.tailAnchor ?? null]),
  );
}

/**
 * Whether a cut's recorded export/upload is stale because the overlays were
 * edited since (#336, re1). Only meaningful once the cut has actually been
 * exported or uploaded; compares the current overlays against the baseline that
 * was on screen when the editor opened (already normalized the same way), so a
 * load-time normalization is not mistaken for a user edit.
 */
export function isExportStale(opts: {
  exported: boolean;
  uploaded: boolean;
  /** Signature of the overlays that match the recorded export (see overlaysSignature). */
  baselineSig: string;
  current: Overlay[] | undefined;
}): boolean {
  if (!opts.exported && !opts.uploaded) return false;
  return opts.baselineSig !== overlaysSignature(opts.current);
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
