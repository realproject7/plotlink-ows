import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { importImageToCompliantBlob, isCompliantImage } from "./import-image";

// #301: the OWS-owned import path converts a Codex-generated local image (e.g. a
// large PNG) into a compliant WebP/JPEG <=1MB entirely in the browser (canvas),
// so it can be saved as a project asset without agent-side shell image tools.
//
// jsdom implements neither createImageBitmap nor canvas encoding, so we stub the
// decode (createImageBitmap) and the encode (HTMLCanvasElement.toBlob) to drive
// the conversion/compression policy deterministically.

const MB = 1024 * 1024;

function makeFile(type: string, size: number, name = "img"): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** Install canvas decode/encode stubs. `encode` decides each toBlob result. */
function stubCanvas(encode: (type: string) => Blob | null) {
  (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = vi.fn(
    async () => ({ width: 64, height: 64, close: vi.fn() }),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
    type?: string,
  ) {
    cb(encode(type ?? "image/png"));
  } as HTMLCanvasElement["toBlob"]);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as unknown as { createImageBitmap?: unknown }).createImageBitmap;
});

describe("isCompliantImage", () => {
  it("accepts WebP/JPEG under 1MB", () => {
    expect(isCompliantImage({ type: "image/webp", size: 1000 })).toBe(true);
    expect(isCompliantImage({ type: "image/jpeg", size: 1000 })).toBe(true);
  });
  it("rejects PNG and oversize images", () => {
    expect(isCompliantImage({ type: "image/png", size: 1000 })).toBe(false);
    expect(isCompliantImage({ type: "image/webp", size: MB + 1 })).toBe(false);
  });
});

describe("importImageToCompliantBlob", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { createImageBitmap?: unknown }).createImageBitmap;
  });

  it("returns an already-compliant WebP/JPEG untouched (no re-encode)", async () => {
    const file = makeFile("image/webp", 5000, "cover.webp");
    const out = await importImageToCompliantBlob(file);
    expect(out).toBe(file); // same reference — not re-encoded
  });

  it("converts a PNG to a WebP Blob under 1MB", async () => {
    // First WebP quality already fits.
    stubCanvas((type) => new Blob([new Uint8Array(4000)], { type }));
    const out = await importImageToCompliantBlob(makeFile("image/png", 4 * MB, "gen.png"));
    expect(out.type).toBe("image/webp");
    expect(out.size).toBeLessThanOrEqual(MB);
  });

  it("falls back to JPEG when the browser cannot encode WebP", async () => {
    // toBlob returns PNG for webp requests (no WebP support) → JPEG ladder used.
    stubCanvas((type) =>
      type === "image/jpeg"
        ? new Blob([new Uint8Array(3000)], { type })
        : new Blob([new Uint8Array(3000)], { type: "image/png" }),
    );
    const out = await importImageToCompliantBlob(makeFile("image/png", 2 * MB, "gen.png"));
    expect(out.type).toBe("image/jpeg");
    expect(out.size).toBeLessThanOrEqual(MB);
  });

  it("throws a clear error when the image cannot be compressed under 1MB", async () => {
    stubCanvas((type) => new Blob([new Uint8Array(2 * MB)], { type })); // every encode too big
    await expect(importImageToCompliantBlob(makeFile("image/png", 8 * MB, "huge.png"))).rejects.toThrow(
      /under 1MB/,
    );
  });

  it("throws a clear error when the image cannot be decoded", async () => {
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = vi.fn(async () => {
      throw new Error("decode failed");
    });
    await expect(importImageToCompliantBlob(makeFile("image/png", 1000, "bad.png"))).rejects.toThrow(
      /Could not read the selected image/,
    );
  });
});
