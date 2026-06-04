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
  | "planned"      // no recorded image path yet (or a text panel awaiting export)
  | "missing"      // a path IS recorded in cuts.json but the file is absent/invalid on disk
  | "clean-ready"  // a valid clean image exists on disk
  | "final-ready"  // a valid exported final/lettered image exists on disk
  | "uploaded";    // an uploaded URL/CID exists (content is on IPFS)

export interface CutAssetDiagnostic {
  cutId: number;
  /** "image" | "text" — text panels need no clean image. */
  kind: "image" | "text";
  state: CutAssetState;
  /** Precise reason when state is "missing" (which path/why), else null. */
  issue: string | null;
}

export interface AssetDiagnosticsSummary {
  planned: number;
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
export function diagnoseCutAsset(cut: Cut, assetIssue: (relPath: string) => string | null): CutAssetDiagnostic {
  const kind: "image" | "text" = isTextPanel(cut) ? "text" : "image";
  const label = `Cut ${cut.id}`;

  if (cut.uploadedUrl || cut.uploadedCid) {
    return { cutId: cut.id, kind, state: "uploaded", issue: null };
  }
  if (cut.finalImagePath) {
    const issue = assetIssue(cut.finalImagePath);
    return issue
      ? { cutId: cut.id, kind, state: "missing", issue: `${label}: final image "${cut.finalImagePath}" — ${issue}` }
      : { cutId: cut.id, kind, state: "final-ready", issue: null };
  }
  if (cut.cleanImagePath) {
    const issue = assetIssue(cut.cleanImagePath);
    return issue
      ? { cutId: cut.id, kind, state: "missing", issue: `${label}: clean image "${cut.cleanImagePath}" — ${issue}` }
      : { cutId: cut.id, kind, state: "clean-ready", issue: null };
  }
  // No recorded path: a not-yet-produced image cut or a text panel awaiting export.
  return { cutId: cut.id, kind, state: "planned", issue: null };
}

export function diagnoseCutAssets(cuts: Cut[], assetIssue: (relPath: string) => string | null): CutAssetDiagnostic[] {
  return cuts.map((cut) => diagnoseCutAsset(cut, assetIssue));
}

export function summarizeAssetDiagnostics(diags: CutAssetDiagnostic[]): AssetDiagnosticsSummary {
  return {
    planned: diags.filter((d) => d.state === "planned").length,
    missing: diags.filter((d) => d.state === "missing").length,
    cleanReady: diags.filter((d) => d.state === "clean-ready").length,
    finalReady: diags.filter((d) => d.state === "final-ready").length,
    uploaded: diags.filter((d) => d.state === "uploaded").length,
  };
}
