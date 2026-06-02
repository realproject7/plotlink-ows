import { describe, it, expect } from "vitest";
import { verifyPublicCartoonTitle, publicTitleWarning } from "./verify-public-title";

describe("verifyPublicCartoonTitle (#379)", () => {
  describe("genesis (storyline) title", () => {
    it("fails when PlotLink indexed the storyline title as the raw 'genesis'", () => {
      const v = verifyPublicCartoonTitle({ fileName: "genesis.md", detail: { title: "genesis" } });
      expect(v.ok).toBe(false);
      expect(v.checked).toBe(true);
      expect(v.publicTitle).toBe("genesis");
    });

    it("fails case-insensitively for 'Genesis'", () => {
      expect(verifyPublicCartoonTitle({ fileName: "genesis.md", detail: { title: "Genesis" } }).ok).toBe(false);
    });

    it("passes for a real reader-facing storyline title", () => {
      const v = verifyPublicCartoonTitle({ fileName: "genesis.md", detail: { title: "Coupon Crush at Closing Time" } });
      expect(v.ok).toBe(true);
      expect(v.checked).toBe(true);
    });

    it("reads the `name` field when `title` is absent", () => {
      expect(verifyPublicCartoonTitle({ fileName: "genesis.md", detail: { name: "genesis" } }).ok).toBe(false);
    });

    it("is inconclusive (checked:false, ok:true) when no public title field is present", () => {
      const v = verifyPublicCartoonTitle({ fileName: "genesis.md", detail: {} });
      expect(v.ok).toBe(true);
      expect(v.checked).toBe(false);
    });
  });

  describe("plot (episode) title", () => {
    // The exact public failure from the pilot: episode images exist (good alt
    // text) but the indexed plot title is the raw `plot-01`.
    it("fails when the indexed plot title is the raw 'plot-01'", () => {
      const v = verifyPublicCartoonTitle({
        fileName: "plot-01.md",
        plotIndex: 1,
        detail: { title: "Coupon Crush", plots: [{ plotIndex: 1, title: "plot-01" }] },
      });
      expect(v.ok).toBe(false);
      expect(v.checked).toBe(true);
      expect(v.publicTitle).toBe("plot-01");
    });

    it("fails when the indexed plot title is a generic 'Episode 01' placeholder", () => {
      const v = verifyPublicCartoonTitle({
        fileName: "plot-01.md",
        plotIndex: 1,
        detail: { plots: [{ plotIndex: 1, title: "Episode 01" }] },
      });
      expect(v.ok).toBe(false);
    });

    it("passes for a real reader-facing episode title", () => {
      const v = verifyPublicCartoonTitle({
        fileName: "plot-01.md",
        plotIndex: 1,
        detail: { plots: [{ plotIndex: 1, title: "The Couple Coupon" }] },
      });
      expect(v.ok).toBe(true);
      expect(v.checked).toBe(true);
    });

    it("does NOT pass a generic title just because the episode images/alt text are fine", () => {
      // Image alt text living elsewhere in the response must not rescue a bad title.
      const v = verifyPublicCartoonTitle({
        fileName: "plot-01.md",
        plotIndex: 1,
        detail: { title: "Coupon Crush", plots: [{ plotIndex: 1, title: "plot-01", name: "Cut 1 — alt text fine" }] },
      });
      expect(v.ok).toBe(false);
    });

    it("matches the plot by `index` too, and reads `chapters` when `plots` is absent", () => {
      expect(
        verifyPublicCartoonTitle({ fileName: "plot-02.md", plotIndex: 2, detail: { plots: [{ index: 2, title: "plot-02" }] } }).ok,
      ).toBe(false);
      expect(
        verifyPublicCartoonTitle({ fileName: "plot-01.md", plotIndex: 1, detail: { chapters: [{ plotIndex: 1, title: "Episode 1" }] } }).ok,
      ).toBe(false);
    });

    it("is inconclusive when the plot title for the published index isn't present", () => {
      const v = verifyPublicCartoonTitle({ fileName: "plot-03.md", plotIndex: 3, detail: { plots: [{ plotIndex: 1, title: "Real Title" }] } });
      expect(v.ok).toBe(true);
      expect(v.checked).toBe(false);
    });
  });

  it("publicTitleWarning explains immutability + corrected-metadata recovery", () => {
    const v = verifyPublicCartoonTitle({ fileName: "genesis.md", detail: { title: "genesis" } });
    const msg = publicTitleWarning(v);
    expect(msg).toContain("genesis");
    expect(msg).toMatch(/immutable/i);
    expect(msg).toMatch(/next publish/i);
  });
});
