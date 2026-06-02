// Shared client-side image compression policy. A single source of truth for the
// "fit a canvas into a PlotLink-compliant (WebP/JPEG, <=1MB) image" routine so
// the lettering export (export-cut.ts) and the Codex-image import path
// (import-image.ts, #301) compress identically — both produce assets the
// upload/import endpoints accept without any agent-side shell image tools.

/** PlotLink hard limit for cover / clean / final cartoon assets. */
export const MAX_IMAGE_BYTES = 1024 * 1024;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`Failed to export as ${format}`))),
      format,
      quality,
    );
  });
}

/**
 * Compress a canvas to a WebP (preferred) or JPEG Blob no larger than
 * MAX_IMAGE_BYTES. Tries descending WebP qualities first; if the browser cannot
 * encode WebP (toBlob silently falls back to PNG) it drops to JPEG. Throws a
 * clear, user-facing error when even the lowest-quality JPEG exceeds the limit,
 * so callers can surface "could not compress under 1MB" rather than silently
 * uploading an oversize asset.
 */
export async function compressCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const webpQualities = [0.9, 0.8, 0.7, 0.6];
  for (const q of webpQualities) {
    try {
      const blob = await canvasToBlob(canvas, "image/webp", q);
      // A browser without WebP encoding returns image/png here — stop trying
      // WebP and fall through to the JPEG ladder rather than emit a PNG.
      if (blob.type !== "image/webp") break;
      if (blob.size <= MAX_IMAGE_BYTES) return blob;
    } catch {
      break;
    }
  }

  const jpegQualities = [0.85, 0.7, 0.5];
  for (const q of jpegQualities) {
    const blob = await canvasToBlob(canvas, "image/jpeg", q);
    if (blob.size <= MAX_IMAGE_BYTES) return blob;
  }

  throw new Error("Cannot compress image under 1MB — reduce overlay count or image size");
}
