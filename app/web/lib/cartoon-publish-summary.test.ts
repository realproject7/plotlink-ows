import { describe, it, expect } from "vitest";
import { summarizeCartoonMarkdown, PROSE_PREVIEW_LIMIT } from "./cartoon-publish-summary";

const block = (url: string, id = "cut-001") =>
  `<!-- ows:cartoon-cut ${id} start -->\n![Scene](${url})\n<!-- ows:cartoon-cut ${id} end -->`;

describe("summarizeCartoonMarkdown", () => {
  it("counts images and characters", () => {
    const md = [block("https://ipfs/Qm1", "cut-001"), block("https://ipfs/Qm2", "cut-002")].join("\n\n");
    const s = summarizeCartoonMarkdown(md);
    expect(s.imageCount).toBe(2);
    expect(s.charCount).toBe(md.length);
  });

  it("reports no non-image prose for clean image-only markdown", () => {
    const md = block("https://ipfs/Qm1");
    const s = summarizeCartoonMarkdown(md);
    expect(s.nonImageProse).toBe("");
    expect(s.nonImageProsePreview).toBe("");
  });

  it("surfaces placeholder/planning prose that sits around the image blocks (#286/#289)", () => {
    const md = [
      "Placeholder only. OWS should generate the publish markdown from `plot-01.cuts.json` after clean images are approved.",
      "",
      block("https://ipfs/Qm1"),
    ].join("\n");
    const s = summarizeCartoonMarkdown(md);
    expect(s.imageCount).toBe(1);
    expect(s.nonImageProse).toContain("Placeholder only");
    expect(s.nonImageProse).not.toContain("ows:cartoon-cut"); // markers stripped
    expect(s.nonImageProse).not.toContain("!["); // image refs stripped
  });

  it("truncates the prose preview to the limit", () => {
    const longProse = "x".repeat(PROSE_PREVIEW_LIMIT + 50);
    const s = summarizeCartoonMarkdown(`${longProse}\n\n${block("https://ipfs/Qm1")}`);
    expect(s.nonImageProsePreview.length).toBe(PROSE_PREVIEW_LIMIT);
    expect(s.nonImageProse.length).toBeGreaterThan(PROSE_PREVIEW_LIMIT);
  });

  it("does not count the cut-planning description from cuts.json (it is not in the markdown)", () => {
    // The inspector shows descriptions/dialogue; the publish markdown does not.
    const md = block("https://ipfs/Qm1");
    const s = summarizeCartoonMarkdown(md);
    expect(s.nonImageProse).toBe("");
  });
});
