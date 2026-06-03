import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { CODEX_IMAGES_DIR } from "../lib/paths";
import { sniffImageType } from "../lib/clean-image-sync";
import {
  listCodexImages,
  resolveCodexImagePath,
  CODEX_MAX_RAW_BYTES,
} from "../lib/codex-images";

/**
 * Codex generated-image cache handoff (#403). Read-only, authenticated routes
 * that let the OWS UI surface the Codex image cache so a writer can import a
 * generated PNG into a cut in one click — instead of hunting through a hidden
 * `~/.codex/generated_images/…` folder in an OS file dialog. The browser does the
 * PNG→WebP conversion and posts to the existing per-cut upload-clean route, so
 * the manual upload path and its validation are unchanged.
 */
const codexImages = new Hono();

const SNIFF_MIME: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// GET /api/codex/images — recent Codex-generated cache images, newest first.
// A missing cache directory simply lists empty (no error).
codexImages.get("/images", (c) => {
  return c.json({ images: listCodexImages(CODEX_IMAGES_DIR) });
});

// GET /api/codex/images/:token — raw bytes of one cache image (for the import
// thumbnail and the import fetch). Path-safe, image-only, size-capped.
codexImages.get("/images/:token", (c) => {
  const resolved = resolveCodexImagePath(CODEX_IMAGES_DIR, c.req.param("token"));
  if (!resolved) return c.json({ error: "Invalid image reference" }, 400);

  try {
    // Defense in depth against a symlinked cache entry escaping the root:
    // resolveCodexImagePath only does logical path math, so re-check the
    // boundary on the realpath (which follows symlinks) before reading.
    const rootReal = fs.realpathSync(path.resolve(CODEX_IMAGES_DIR));
    const fileReal = fs.realpathSync(resolved.abs);
    if (fileReal !== rootReal && !fileReal.startsWith(rootReal + path.sep)) {
      return c.json({ error: "Invalid image reference" }, 400);
    }

    const st = fs.statSync(fileReal);
    if (!st.isFile()) return c.json({ error: "Not found" }, 404);
    if (st.size > CODEX_MAX_RAW_BYTES) return c.json({ error: "Image too large" }, 413);

    const buf = fs.readFileSync(fileReal);
    const kind = sniffImageType(new Uint8Array(buf));
    if (kind === "unknown") return c.json({ error: "Not an image" }, 415);

    c.header("Content-Type", SNIFF_MIME[kind]);
    c.header("Cache-Control", "no-store");
    return c.body(new Uint8Array(buf));
  } catch {
    // Missing file, broken symlink, or unreadable entry — treat as not found.
    return c.json({ error: "Not found" }, 404);
  }
});

export { codexImages as codexImagesRoutes };
