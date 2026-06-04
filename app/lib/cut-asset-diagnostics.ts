// Read-only per-cut asset diagnostics (#427).
//
// After an agent generates clean images on disk (outside the React UI), the app
// needs a reliable way to NOTICE and EXPLAIN each cut's asset state — otherwise a
// writer sees "image missing" or a prose preview even though files exist (the
// god-cell pilot). `getCutStatus` in the UI trusts the recorded cuts.json fields
// and never checks disk, so a recorded-but-missing/typoed path looks "ready".
//
// This classifies each cut's REAL asset state against the local story folder and
// surfaces a precise per-cut reason when a recorded path doesn't resolve. Pure +
// framework-free (the disk check is injected) so it's unit-testable and works for
// genesis.cuts.json and plot-NN.cuts.json equally. Read-only: never mutates cuts.

import { isTextPanel, type Cut } from "./cuts";

export type CutAssetState =
  | "planned"          // no recorded image path yet (or a text panel awaiting export)
  | "needs-conversion" // a PNG clean image exists but must be converted to WebP/JPEG (#441)
  | "missing"          // a path IS recorded in cuts.json but the file is absent/invalid on disk
  | "clean-ready"      // a valid clean image exists on disk
  | "final-ready"      // a valid exported final/lettered image exists on disk
  | "uploaded";        // an uploaded URL/CID exists (content is on IPFS)

export interface CutAssetDiagnostic {
  cutId: number;
  /** "image" | "text" — text panels need no clean image. */
  kind: "image" | "text";
  state: CutAssetState;
  /**
   * Precise reason when state is "missing", OR the raw unsupported-extension
   * detail for "needs-conversion" (the UI hides it under "Technical details").
   * Null otherwise.
   */
  issue: string | null;
  /**
   * For "needs-conversion": the relative path of the PNG clean image to convert
   * (the client fetches + converts it to WebP). Null for every other state.
   */
  convertiblePng: string | null;
}

export interface AssetDiagnosticsSummary {
  planned: number;
  needsConversion: number;
  missing: number;
  cleanReady: number;
  finalReady: number;
  uploaded: number;
}

/**
 * Classify one cut's asset state against disk. `assetIssue(relPath)` returns null
 * when the recorded path is a valid local image asset, else a precise reason
 * (missing file, wrong type, too large, traversal) — typically `imageAssetIssue`.
 *
 * Precedence mirrors the production pipeline AND the existing stale-path logic:
 * an uploaded cut is "uploaded" regardless of local files (content is on IPFS);
 * otherwise the most-advanced recorded path wins, and a recorded-but-broken path
 * is surfaced as "missing" with the precise reason rather than silently trusted.
 */
/**
 * Classify one cut's asset state against disk. `assetIssue(relPath)` returns the
 * publish-strict validity (WebP/JPEG, ≤1MB, magic-byte match). `pngClean(cut)`
 * returns the relative path of a convertible PNG clean image for this cut (or
 * null) — when a cut has no VALID clean image but a PNG one exists, that is a
 * friendly "needs-conversion" step (#441), not a red unsupported-extension
 * error. Defaults to no-PNG so existing callers/tests are unaffected.
 */
export function diagnoseCutAsset(
  cut: Cut,
  assetIssue: (relPath: string) => string | null,
  pngClean: (cut: Cut) => string | null = () => null,
): CutAssetDiagnostic {
  const kind: "image" | "text" = isTextPanel(cut) ? "text" : "image";
  const label = `Cut ${cut.id}`;
  // Text panels never need a clean image, so they are never "needs-conversion".
  const png = kind === "image" ? pngClean(cut) : null;

  if (cut.uploadedUrl || cut.uploadedCid) {
    return { cutId: cut.id, kind, state: "uploaded", issue: null, convertiblePng: null };
  }
  if (cut.finalImagePath) {
    const issue = assetIssue(cut.finalImagePath);
    return issue
      ? { cutId: cut.id, kind, state: "missing", issue: `${label}: final image "${cut.finalImagePath}" — ${issue}`, convertiblePng: null }
      : { cutId: cut.id, kind, state: "final-ready", issue: null, convertiblePng: null };
  }
  if (cut.cleanImagePath) {
    const issue = assetIssue(cut.cleanImagePath);
    if (!issue) return { cutId: cut.id, kind, state: "clean-ready", issue: null, convertiblePng: null };
    // Recorded clean path is invalid. A real PNG (the usual cause) is a normal
    // conversion step; keep the raw reason as a hide-able technical detail.
    if (png) return { cutId: cut.id, kind, state: "needs-conversion", issue: `${label}: clean image "${cut.cleanImagePath}" — ${issue}`, convertiblePng: png };
    return { cutId: cut.id, kind, state: "missing", issue: `${label}: clean image "${cut.cleanImagePath}" — ${issue}`, convertiblePng: null };
  }
  // No recorded path: a PNG clean image may still be sitting on disk (the agent
  // wrote it but didn't record it) — offer conversion rather than "image missing".
  if (png) return { cutId: cut.id, kind, state: "needs-conversion", issue: null, convertiblePng: png };
  // Otherwise a not-yet-produced image cut or a text panel awaiting export.
  return { cutId: cut.id, kind, state: "planned", issue: null, convertiblePng: null };
}

export function diagnoseCutAssets(
  cuts: Cut[],
  assetIssue: (relPath: string) => string | null,
  pngClean: (cut: Cut) => string | null = () => null,
): CutAssetDiagnostic[] {
  return cuts.map((cut) => diagnoseCutAsset(cut, assetIssue, pngClean));
}

export function summarizeAssetDiagnostics(diags: CutAssetDiagnostic[]): AssetDiagnosticsSummary {
  return {
    planned: diags.filter((d) => d.state === "planned").length,
    needsConversion: diags.filter((d) => d.state === "needs-conversion").length,
    missing: diags.filter((d) => d.state === "missing").length,
    cleanReady: diags.filter((d) => d.state === "clean-ready").length,
    finalReady: diags.filter((d) => d.state === "final-ready").length,
    uploaded: diags.filter((d) => d.state === "uploaded").length,
  };
}
