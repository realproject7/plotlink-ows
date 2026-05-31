import type { Cut } from "./cuts";

export interface CleanImageSyncResult {
  cuts: Cut[];
  changed: boolean;
  synced: number[];
}

/** Preference order for clean-image extensions when several files exist. */
export const CLEAN_IMAGE_EXTENSIONS = ["webp", "jpg", "jpeg", "png"] as const;

/** Canonical clean-image relative paths for a cut, in preference order. */
export function cleanImageCandidates(plotFile: string, cutId: number): string[] {
  const padded = String(cutId).padStart(2, "0");
  return CLEAN_IMAGE_EXTENSIONS.map((ext) => `assets/${plotFile}/cut-${padded}-clean.${ext}`);
}

/**
 * Pure detector that records `cleanImagePath` for cuts whose clean image
 * actually exists on disk. The caller injects `fileExists(relPath)` so this
 * function performs no filesystem access and no mime/size validation — those
 * are the route's responsibility (the route's `fileExists` should return true
 * ONLY for files that exist AND pass validation).
 *
 * Rules (idempotent, only-if-exists, never fake):
 *  - For each cut, find the first existing canonical candidate (webp > jpg >
 *    jpeg > png).
 *  - Set `cleanImagePath` to the found file ONLY when:
 *      (a) the cut's current path is null and a file is found; or
 *      (b) the cut's current path is set but no longer exists on disk (stale/
 *          broken) AND a different existing file is found.
 *  - A cut whose current `cleanImagePath` still exists on disk is preserved
 *    (manual uploads are never clobbered).
 *  - A path is never cleared just because no file was found — this is
 *    detection/import only.
 *
 * Returns a new array; the input is not mutated.
 */
export function syncCleanImages(
  cuts: Cut[],
  plotFile: string,
  fileExists: (relPath: string) => boolean,
): CleanImageSyncResult {
  const synced: number[] = [];
  let changed = false;

  const next = cuts.map((cut) => {
    const current = cut.cleanImagePath;
    const currentExists = current != null && fileExists(current);

    // Preserve a still-valid manual/existing path.
    if (currentExists) return cut;

    const candidates = cleanImageCandidates(plotFile, cut.id);
    const found = candidates.find((rel) => fileExists(rel)) ?? null;
    if (!found) return cut;

    // (a) null → found, or (b) stale/broken path replaced by a different file.
    if (current === null || current !== found) {
      changed = true;
      synced.push(cut.id);
      return { ...cut, cleanImagePath: found };
    }

    return cut;
  });

  return { cuts: next, changed, synced };
}
