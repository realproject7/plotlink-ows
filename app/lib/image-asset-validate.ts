import fs from "fs";
import path from "path";
import { sniffImageType, type SniffedType } from "./clean-image-sync";

// Shared filesystem validation for cartoon clean/final image assets. A single
// source of truth for "is this recorded/candidate relative path a real, valid
// WebP/JPEG file" — used by the sync/detect endpoints and by the stale-path
// detection that gates publish readiness (#302).

export const CLEAN_IMAGE_MAX_BYTES = 1024 * 1024;
export const CLEAN_IMAGE_VALID_EXT = new Set(["webp", "jpg", "jpeg"]);

/** Map an allowed file extension to the image type its content must match. */
export const CLEAN_IMAGE_EXT_TO_TYPE: Record<string, Exclude<SniffedType, "unknown">> = {
  webp: "webp",
  jpg: "jpeg",
  jpeg: "jpeg",
};

/**
 * Validate a relative asset path against the real filesystem. Returns `null`
 * when the file exists and is a valid WebP/JPEG (regular file, allowed
 * extension, <=1MB, magic-byte content matches the extension); otherwise a short
 * reason string. Filesystem read only — never mutates anything.
 *
 * `"missing"` covers a non-existent path, a non-regular file, or an unreadable
 * file; the other reasons describe a present-but-invalid asset.
 */
export function imageAssetIssue(storyDir: string, relPath: string): string | null {
  const abs = path.join(storyDir, relPath);
  if (!fs.existsSync(abs)) return "missing";

  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return "missing";
  }
  if (!stat.isFile()) return "missing";

  const ext = path.extname(relPath).slice(1).toLowerCase();
  if (!CLEAN_IMAGE_VALID_EXT.has(ext)) return `Unsupported extension .${ext}`;
  if (stat.size > CLEAN_IMAGE_MAX_BYTES) return "File must be under 1MB";

  // Sniff the real content so a text file (or a renamed/mismatched image) named
  // `.webp`/`.jpg` cannot pass on extension alone.
  let sniffed: SniffedType;
  try {
    const fd = fs.openSync(abs, "r");
    try {
      const head = Buffer.alloc(16);
      const read = fs.readSync(fd, head, 0, 16, 0);
      sniffed = sniffImageType(head.subarray(0, read));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "missing";
  }

  if (sniffed === "unknown") return "not a valid image (content does not match WebP/JPEG/PNG)";
  if (sniffed !== CLEAN_IMAGE_EXT_TO_TYPE[ext]) return `content does not match .${ext} extension`;
  return null;
}

/** True when a relative asset path is a real, valid WebP/JPEG file on disk. */
export function isValidImageAsset(storyDir: string, relPath: string): boolean {
  return imageAssetIssue(storyDir, relPath) === null;
}
