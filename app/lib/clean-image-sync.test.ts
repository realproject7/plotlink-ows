import { describe, it, expect } from "vitest";
import { syncCleanImages, cleanImageCandidates, sniffImageType, cleanImageBytesMatchMime, CLEAN_IMAGE_EXTENSIONS } from "./clean-image-sync";
import { createDefaultCut } from "./cuts";

function cut(id: number, overrides: Partial<ReturnType<typeof createDefaultCut>> = {}) {
  return { ...createDefaultCut(id, "plot-01"), ...overrides };
}

describe("CLEAN_IMAGE_EXTENSIONS", () => {
  it("is WebP/JPEG only and no longer includes png", () => {
    expect(CLEAN_IMAGE_EXTENSIONS).toEqual(["webp", "jpg", "jpeg"]);
    expect((CLEAN_IMAGE_EXTENSIONS as readonly string[]).includes("png")).toBe(false);
  });
});

describe("cleanImageCandidates", () => {
  it("lists canonical paths in preference order with zero-padded id (no png)", () => {
    expect(cleanImageCandidates("plot-01", 3)).toEqual([
      "assets/plot-01/cut-03-clean.webp",
      "assets/plot-01/cut-03-clean.jpg",
      "assets/plot-01/cut-03-clean.jpeg",
    ]);
  });

  it("never produces a .png candidate", () => {
    const cands = cleanImageCandidates("plot-01", 1);
    expect(cands.some((p) => p.endsWith(".png"))).toBe(false);
  });
});

describe("sniffImageType", () => {
  it("detects JPEG from FF D8 FF magic", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("jpeg");
  });

  it("detects PNG from 89 50 4E 47 0D 0A 1A 0A magic", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe("png");
  });

  it("detects WebP from RIFF....WEBP magic", () => {
    expect(
      sniffImageType(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00]),
      ),
    ).toBe("webp");
  });

  it("returns unknown for RIFF without WEBP marker", () => {
    expect(
      sniffImageType(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20]),
      ),
    ).toBe("unknown");
  });

  it("returns unknown for text/garbage", () => {
    expect(sniffImageType(new TextEncoder().encode("hello world"))).toBe("unknown");
  });

  it("returns unknown for a too-short buffer", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBe("unknown");
    expect(sniffImageType(new Uint8Array([]))).toBe("unknown");
  });
});

describe("cleanImageBytesMatchMime (manual upload byte validation, #266)", () => {
  const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00]);
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const TEXT = new TextEncoder().encode("this is not an image");

  it("accepts WebP bytes labeled image/webp", () => {
    expect(cleanImageBytesMatchMime(WEBP, "image/webp")).toBe(true);
  });

  it("accepts JPEG bytes labeled image/jpeg", () => {
    expect(cleanImageBytesMatchMime(JPEG, "image/jpeg")).toBe(true);
  });

  it("rejects text bytes labeled image/webp (renamed file)", () => {
    expect(cleanImageBytesMatchMime(TEXT, "image/webp")).toBe(false);
  });

  it("rejects PNG bytes labeled image/webp (content/type mismatch)", () => {
    expect(cleanImageBytesMatchMime(PNG, "image/webp")).toBe(false);
  });

  it("rejects WebP bytes labeled image/jpeg (content/type mismatch)", () => {
    expect(cleanImageBytesMatchMime(WEBP, "image/jpeg")).toBe(false);
  });

  it("rejects an accepted image type under a non-accepted MIME (e.g. image/png)", () => {
    expect(cleanImageBytesMatchMime(PNG, "image/png")).toBe(false);
    expect(cleanImageBytesMatchMime(WEBP, "image/png")).toBe(false);
  });
});

describe("syncCleanImages", () => {
  it("sets path and records id when current is null and a webp exists", () => {
    const cuts = [cut(1)];
    const exists = (p: string) => p === "assets/plot-01/cut-01-clean.webp";
    const res = syncCleanImages(cuts, "plot-01", exists);
    expect(res.changed).toBe(true);
    expect(res.synced).toEqual([1]);
    expect(res.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
    // input not mutated
    expect(cuts[0].cleanImagePath).toBeNull();
  });

  it("preserves an existing-valid path (no change, even if other candidates exist)", () => {
    const cuts = [cut(1, { cleanImagePath: "assets/plot-01/cut-01-clean.jpg" })];
    const exists = () => true; // every candidate "exists"
    const res = syncCleanImages(cuts, "plot-01", exists);
    expect(res.changed).toBe(false);
    expect(res.synced).toEqual([]);
    expect(res.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.jpg");
  });

  it("replaces a stale/broken path with the found file", () => {
    const cuts = [cut(1, { cleanImagePath: "assets/plot-01/cut-01-clean.png" })];
    const exists = (p: string) => p === "assets/plot-01/cut-01-clean.webp";
    const res = syncCleanImages(cuts, "plot-01", exists);
    expect(res.changed).toBe(true);
    expect(res.synced).toEqual([1]);
    expect(res.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
  });

  it("prefers webp over jpg when both exist", () => {
    const cuts = [cut(1)];
    const exists = (p: string) =>
      p === "assets/plot-01/cut-01-clean.webp" || p === "assets/plot-01/cut-01-clean.jpg";
    const res = syncCleanImages(cuts, "plot-01", exists);
    expect(res.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
  });

  it("leaves cut unchanged and does not clear when no file is found", () => {
    const cuts = [cut(1), cut(2, { cleanImagePath: "assets/plot-01/cut-02-clean.webp" })];
    // cut 1 has nothing; cut 2's path does not exist on disk and no candidate exists
    const exists = () => false;
    const res = syncCleanImages(cuts, "plot-01", exists);
    expect(res.changed).toBe(false);
    expect(res.synced).toEqual([]);
    expect(res.cuts[0].cleanImagePath).toBeNull();
    // not cleared
    expect(res.cuts[1].cleanImagePath).toBe("assets/plot-01/cut-02-clean.webp");
  });

  it("is idempotent: a second run with the same disk reports no change", () => {
    const cuts = [cut(1)];
    const exists = (p: string) => p === "assets/plot-01/cut-01-clean.webp";
    const first = syncCleanImages(cuts, "plot-01", exists);
    expect(first.changed).toBe(true);
    const second = syncCleanImages(first.cuts, "plot-01", exists);
    expect(second.changed).toBe(false);
    expect(second.synced).toEqual([]);
    expect(second.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
  });
});
