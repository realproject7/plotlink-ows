// Codex generated-image cache handoff (#403) — client side.
//
// Built-in image generation drops finished cartoon art into a hidden cache
// (`~/.codex/generated_images/.../ig_<hash>.png`) as a PNG, usually > 1MB. OWS
// only records WebP/JPEG <= 1MB clean assets, and the agent terminal is forbidden
// from converting the file itself (#297). Rather than make the writer hunt through
// that hidden folder in an OS file dialog, the OWS app lists the cache (read-only,
// authenticated) and lets the writer import one generated image straight into a
// cut — the browser converts the PNG exactly like the existing manual upload
// (importImageToCompliantBlob), so the upload route and its validation are
// unchanged.
//
// This module owns the two read-only calls to the `/api/codex` routes: list the
// cache, and fetch one cache image's raw bytes as a File ready for the existing
// import/upload pipeline. Kept thin and free of React so the fetch→File wiring is
// unit-testable.

/** One entry in the Codex generated-image cache, as returned by GET /api/codex/images. */
export interface CodexCacheImage {
  /** Opaque, path-safe token addressing this cache file (relative to the root). */
  token: string;
  /** Base file name, e.g. `ig_0f26….png`, for display. */
  name: string;
  /** Raw file size in bytes (pre-conversion). */
  size: number;
  /** Last-modified time (ms since epoch); the server lists newest first. */
  mtimeMs: number;
}

type AuthFetch = (url: string, opts?: RequestInit) => Promise<Response>;

/** Narrow an unknown listing entry to a well-formed CodexCacheImage. */
function isCacheImage(v: unknown): v is CodexCacheImage {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.token === "string" &&
    o.token.length > 0 &&
    typeof o.name === "string" &&
    typeof o.size === "number" &&
    typeof o.mtimeMs === "number"
  );
}

/**
 * List recent Codex-generated cache images, newest first. Best-effort: a non-OK
 * response or a malformed body yields `[]` (the cache is optional infrastructure —
 * a writer without Codex installed simply sees no import option), and only
 * well-formed entries are kept.
 */
export async function listCodexCacheImages(authFetch: AuthFetch): Promise<CodexCacheImage[]> {
  let res: Response;
  try {
    res = await authFetch("/api/codex/images");
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return [];
  }
  const images = (data as { images?: unknown })?.images;
  if (!Array.isArray(images)) return [];
  return images.filter(isCacheImage);
}

/**
 * Fetch one cache image's raw bytes and wrap them in a File ready for the existing
 * per-cut import pipeline (importImageToCompliantBlob → upload-clean). The File
 * keeps the cache entry's name and the response's real content type, so a large
 * PNG flows through the same in-browser conversion a manually-picked PNG does.
 * Throws a clear, user-facing error when the image can't be fetched, so callers
 * surface the gap instead of importing nothing silently.
 */
export async function fetchCodexCacheFile(
  authFetch: AuthFetch,
  image: CodexCacheImage,
): Promise<File> {
  let res: Response;
  try {
    res = await authFetch(`/api/codex/images/${encodeURIComponent(image.token)}`);
  } catch {
    throw new Error("Could not read the generated image from the Codex cache");
  }
  if (!res.ok) {
    throw new Error("Could not read the generated image from the Codex cache");
  }
  const blob = await res.blob();
  const type = blob.type || res.headers.get("Content-Type") || "image/png";
  return new File([blob], image.name || "codex-image.png", { type });
}
