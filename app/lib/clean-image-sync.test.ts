import { describe, it, expect } from "vitest";
import { syncCleanImages, cleanImageCandidates } from "./clean-image-sync";
import { createDefaultCut } from "./cuts";

function cut(id: number, overrides: Partial<ReturnType<typeof createDefaultCut>> = {}) {
  return { ...createDefaultCut(id, "plot-01"), ...overrides };
}

describe("cleanImageCandidates", () => {
  it("lists canonical paths in preference order with zero-padded id", () => {
    expect(cleanImageCandidates("plot-01", 3)).toEqual([
      "assets/plot-01/cut-03-clean.webp",
      "assets/plot-01/cut-03-clean.jpg",
      "assets/plot-01/cut-03-clean.jpeg",
      "assets/plot-01/cut-03-clean.png",
    ]);
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
