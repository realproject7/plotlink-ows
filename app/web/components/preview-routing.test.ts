import { describe, it, expect } from "vitest";

function shouldUseCartoonPreview(
  contentType: "fiction" | "cartoon" | undefined,
  fileName: string | null,
): boolean {
  if (!fileName) return false;
  const isPlot = /^plot-\d+\.md$/.test(fileName);
  return contentType === "cartoon" && isPlot;
}

describe("preview routing", () => {
  describe("fiction fallback", () => {
    it("uses markdown preview when contentType is fiction", () => {
      expect(shouldUseCartoonPreview("fiction", "plot-01.md")).toBe(false);
    });

    it("uses markdown preview when contentType is undefined", () => {
      expect(shouldUseCartoonPreview(undefined, "plot-01.md")).toBe(false);
    });

    it("uses markdown preview for fiction genesis.md", () => {
      expect(shouldUseCartoonPreview("fiction", "genesis.md")).toBe(false);
    });

    it("uses markdown preview for fiction structure.md", () => {
      expect(shouldUseCartoonPreview("fiction", "structure.md")).toBe(false);
    });
  });

  describe("cartoon routing", () => {
    it("uses cartoon preview for cartoon plot-01.md", () => {
      expect(shouldUseCartoonPreview("cartoon", "plot-01.md")).toBe(true);
    });

    it("uses cartoon preview for cartoon plot-12.md", () => {
      expect(shouldUseCartoonPreview("cartoon", "plot-12.md")).toBe(true);
    });

    it("uses markdown preview for cartoon genesis.md", () => {
      expect(shouldUseCartoonPreview("cartoon", "genesis.md")).toBe(false);
    });

    it("uses markdown preview for cartoon structure.md", () => {
      expect(shouldUseCartoonPreview("cartoon", "structure.md")).toBe(false);
    });

    it("uses markdown preview when fileName is null", () => {
      expect(shouldUseCartoonPreview("cartoon", null)).toBe(false);
    });
  });
});
