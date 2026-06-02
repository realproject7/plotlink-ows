import { compressCanvasToBlob, MAX_IMAGE_BYTES } from "./image-compress";

// OWS-owned import path for Codex-generated cartoon images (#301).
//
// Codex image generation often lands a large PNG in its local cache. OWS only
// accepts WebP/JPEG <=1MB for cover (assets/cover.webp) and clean
// (assets/plot-NN/cut-XX-clean.webp) assets, and #297 correctly forbids the
// agent from shelling out to ImageMagick/sharp/Playwright to convert it. This
// converts a selected local image entirely in the browser (canvas), so a PNG
// becomes a compliant asset with no agent-side image tooling.

/** Image MIME types the import/upload endpoints accept as-is. */
const COMPLIANT_TYPES = ["image/webp", "image/jpeg"];

/** True when a file already satisfies the PlotLink asset constraints. */
export function isCompliantImage(file: { type: string; size: number }): boolean {
  return COMPLIANT_TYPES.includes(file.type) && file.size <= MAX_IMAGE_BYTES;
}

async function decodeToCanvas(file: File): Promise<HTMLCanvasElement> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot decode the image for import");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Could not read the selected image — pick a PNG, WebP, or JPEG file");
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process the image for import");
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    // Release decoded pixels promptly; large PNGs are the common input here.
    bitmap.close?.();
  }
}

/**
 * Convert a locally-selected image (PNG, WebP, JPEG, …) into a PlotLink-compliant
 * WebP/JPEG Blob <=1MB. Already-compliant files are returned untouched (no
 * re-encode, preserving quality and the existing manual upload behavior).
 * Throws a clear, user-facing error when the source cannot be decoded or cannot
 * be compressed under 1MB, so callers surface the gap instead of saving an
 * invalid asset.
 */
export async function importImageToCompliantBlob(file: File): Promise<Blob> {
  if (isCompliantImage(file)) return file;
  const canvas = await decodeToCanvas(file);
  return compressCanvasToBlob(canvas);
}

export { MAX_IMAGE_BYTES };
