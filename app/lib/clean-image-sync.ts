import type { Cut } from "./cuts";

export interface CleanImageSyncResult {
  cuts: Cut[];
  changed: boolean;
  synced: number[];
  /** Cut ids whose stale recorded `cleanImagePath` was cleared back to null
   *  because the referenced file no longer exists and no valid candidate was
   *  found (#302). */
  cleared: number[];
}

/** A recorded cut asset path that no longer points to a valid local image. */
export interface StaleAssetIssue {
  cutId: number;
  field: "cleanImagePath" | "finalImagePath";
  path: string;
  message: string;
}

/** Preference order for clean-image extensions when several files exist. */
export const CLEAN_IMAGE_EXTENSIONS = ["webp", "jpg", "jpeg"] as const;

/** Image type detected from a file's leading magic bytes. */
export type SniffedType = "webp" | "jpeg" | "png" | "unknown";

/**
 * Detect an image type from leading magic bytes. Pure (no filesystem). Returns
 * "unknown" for non-image / mismatched / too-short input.
 *
 *  - JPEG: FF D8 FF
 *  - PNG:  89 50 4E 47 0D 0A 1A 0A
 *  - WebP: bytes 0-3 = "RIFF" (52 49 46 46) AND bytes 8-11 = "WEBP" (57 45 42 50)
 */
export function sniffImageType(bytes: Uint8Array): SniffedType {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return "unknown";
}

/**
 * Validate that an uploaded file's actual magic bytes match its claimed image
 * MIME type. Pure (no fs). Used by the manual `upload-clean` route (#266) so a
 * renamed text/PNG file labeled `image/webp` cannot be recorded as a clean
 * image. Only the cartoon clean-image formats (WebP/JPEG) are accepted.
 */
export function cleanImageBytesMatchMime(bytes: Uint8Array, mime: string): boolean {
  const expected: SniffedType | null =
    mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpeg" : null;
  if (expected === null) return false;
  return sniffImageType(bytes) === expected;
}

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
 *  - A recorded `cleanImagePath` whose file no longer exists/validates is
 *    cleared back to null when no valid candidate is found, so the cut plan
 *    stops claiming a clean image that isn't there (#302). A cut already null
 *    stays null.
 *
 * Returns a new array; the input is not mutated.
 */
export function syncCleanImages(
  cuts: Cut[],
  plotFile: string,
  fileExists: (relPath: string) => boolean,
): CleanImageSyncResult {
  const synced: number[] = [];
  const cleared: number[] = [];
  let changed = false;

  const next = cuts.map((cut) => {
    const current = cut.cleanImagePath;
    const currentExists = current != null && fileExists(current);

    // Preserve a still-valid manual/existing path.
    if (currentExists) return cut;

    const candidates = cleanImageCandidates(plotFile, cut.id);
    const found = candidates.find((rel) => fileExists(rel)) ?? null;
    if (!found) {
      // No valid file for this cut. If a path was recorded but the file is
      // gone/invalid (stale), clear it back to null rather than preserving a
      // reference to a missing asset. Already-null cuts are untouched.
      if (current !== null) {
        changed = true;
        cleared.push(cut.id);
        return { ...cut, cleanImagePath: null };
      }
      return cut;
    }

    // (a) null → found, or (b) stale/broken path replaced by a different file.
    if (current === null || current !== found) {
      changed = true;
      synced.push(cut.id);
      return { ...cut, cleanImagePath: found };
    }

    return cut;
  });

  return { cuts: next, changed, synced, cleared };
}

/**
 * Pure detector for cut asset paths recorded in cuts.json that no longer point
 * to a valid local image (#302). The caller injects `assetExists(relPath)`,
 * which must return true only when the file exists AND validates (exists, image
 * bytes, size). Reports both `cleanImagePath` and `finalImagePath`; the cut
 * label uses 1-based position to match the readiness messaging ("Cut N ...").
 *
 * Pure: no filesystem access, no mutation. Cuts with null paths produce no
 * issue (an absent path is a normal not-yet-generated state, not staleness).
 */
export function findStaleAssetPaths(
  cuts: Cut[],
  assetExists: (relPath: string) => boolean,
): StaleAssetIssue[] {
  const issues: StaleAssetIssue[] = [];
  cuts.forEach((cut, i) => {
    const label = `Cut ${i + 1}`;
    if (cut.cleanImagePath && !assetExists(cut.cleanImagePath)) {
      issues.push({
        cutId: cut.id,
        field: "cleanImagePath",
        path: cut.cleanImagePath,
        message: `${label} clean image path is recorded but the file is missing`,
      });
    }
    if (cut.finalImagePath && !assetExists(cut.finalImagePath)) {
      issues.push({
        cutId: cut.id,
        field: "finalImagePath",
        path: cut.finalImagePath,
        message: `${label} final image path is recorded but the file is missing`,
      });
    }
  });
  return issues;
}
