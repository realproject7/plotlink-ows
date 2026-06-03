import fs from "fs";
import path from "path";

/**
 * Codex generated-image cache handoff (#403).
 *
 * Built-in image generation drops finished art into a CACHE such as
 * `~/.codex/generated_images/.../ig_<hash>.png` — a PNG, often > 1MB — which the
 * OWS clean-image slot cannot accept directly (it requires WebP/JPEG < 1MB) and
 * the agent terminal cannot convert (image tooling is banned). Rather than make
 * the writer hunt through that hidden cache in an OS file dialog, OWS surfaces
 * the cache contents so they can import a generated image into a specific cut in
 * one click; the browser then converts/compresses it exactly like a manual
 * upload.
 *
 * This module is the path-safety + listing core for that handoff. It is pure
 * path math + read-only fs, so the traversal guards are unit-testable without a
 * running server.
 */

export interface CodexImageEntry {
  /** Opaque, URL-safe token encoding the path RELATIVE to the cache root. */
  token: string;
  /** Base file name for display, e.g. `ig_0f26….png`. */
  name: string;
  /** File size in bytes. */
  size: number;
  /** Last-modified time (ms since epoch) — listings are newest first. */
  mtimeMs: number;
}

/** Max images returned by a single listing (newest first). */
export const CODEX_LIST_LIMIT = 40;
/**
 * Max raw bytes served for one cache image. A generated PNG is a few MB; this is
 * a generous upper bound that still refuses to stream something pathological
 * before the browser converts it down to the < 1MB final asset.
 */
export const CODEX_MAX_RAW_BYTES = 25 * 1024 * 1024;
/** Bounded recursion so a huge or symlink-looping cache tree can't stall a scan. */
const MAX_SCAN_DEPTH = 4;
const MAX_SCAN_FILES = 2000;

const IMAGE_EXTS = new Set(["png", "webp", "jpg", "jpeg"]);

function hasImageExt(name: string): boolean {
  return IMAGE_EXTS.has(path.extname(name).slice(1).toLowerCase());
}

/** URL-safe base64 of a cache-relative path (no `+`/`/`/`=` to break a URL). */
export function encodeCodexToken(relPath: string): string {
  return Buffer.from(relPath, "utf8").toString("base64url");
}

/**
 * Decode a token back to a cache-relative path, returning null for anything
 * unsafe up front: empty, undecodable to text, NUL-bearing, absolute, or
 * containing a `..` segment. This is the FIRST of two traversal guards — the
 * caller must still resolve against the cache root and re-check the boundary
 * (see {@link resolveCodexImagePath}), because base64url decoding is lenient and
 * a crafted token could still decode to a path that escapes the root.
 */
export function decodeCodexToken(token: string): string | null {
  if (!token) return null;
  let rel: string;
  try {
    rel = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!rel || rel.includes("\0")) return null;
  if (path.isAbsolute(rel)) return null;
  if (rel.split(/[\\/]/).some((seg) => seg === "..")) return null;
  return rel;
}

/**
 * Resolve a token to an absolute path that is GUARANTEED to sit inside the cache
 * root, or null when the token is unsafe or escapes the root. Pure path math (no
 * fs) so the boundary guard is unit-testable; the route layer adds a
 * realpath/symlink re-check plus the image-content and size checks.
 */
export function resolveCodexImagePath(
  root: string,
  token: string,
): { abs: string; relPath: string } | null {
  const relPath = decodeCodexToken(token);
  if (relPath == null) return null;
  const rootResolved = path.resolve(root);
  const abs = path.resolve(rootResolved, relPath);
  // Boundary check on the resolved path — not a bare path.join — so a token that
  // decodes to something escaping the root is rejected even if it slipped the
  // up-front `..` check via odd separators.
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) return null;
  // A token decoding to "" resolves to the root dir itself, which is not a file.
  if (abs === rootResolved) return null;
  return { abs, relPath };
}

/**
 * List recent image files under the Codex generated-image cache, newest first.
 * Read-only and best-effort: a missing root yields `[]`, unreadable subtrees are
 * skipped, and both recursion depth and file count are bounded so a pathological
 * cache tree cannot stall the request.
 */
export function listCodexImages(root: string, limit: number = CODEX_LIST_LIMIT): CodexImageEntry[] {
  const rootResolved = path.resolve(root);
  if (!fs.existsSync(rootResolved)) return [];

  const found: { relPath: string; name: string; size: number; mtimeMs: number }[] = [];
  let scanned = 0;

  const walk = (dir: string, depth: number) => {
    if (depth > MAX_SCAN_DEPTH || scanned >= MAX_SCAN_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (scanned >= MAX_SCAN_FILES) return;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
      } else if (ent.isFile() && hasImageExt(ent.name)) {
        scanned++;
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        found.push({
          relPath: path.relative(rootResolved, full),
          name: ent.name,
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      }
    }
  };

  walk(rootResolved, 0);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, limit).map((f) => ({
    token: encodeCodexToken(f.relPath),
    name: f.name,
    size: f.size,
    mtimeMs: f.mtimeMs,
  }));
}
