import { describe, it, expect } from "vitest";
import { checkCartoonReadiness, checkMarkdownReadiness } from "./cartoon-readiness";
import type { Cut } from "./cuts";

function makeCut(overrides: Partial<Cut> = {}): Cut {
  return {
    id: 1, shotType: "medium", description: "", characters: [],
    dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null,
    exportedAt: null, uploadedCid: null, uploadedUrl: null,
    overlays: [],
    ...overrides,
  };
}

describe("checkCartoonReadiness", () => {
  it("fully ready cuts pass", () => {
    const cuts = [makeCut({
      cleanImagePath: "x.webp", finalImagePath: "x-final.webp", exportedAt: "2026-01-01",
      uploadedCid: "Qm", uploadedUrl: "https://ipfs/Qm",
      overlays: [{ id: "1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }],
    })];
    const { ready, issues } = checkCartoonReadiness(cuts);
    expect(ready).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it("reports missing clean image", () => {
    const { issues } = checkCartoonReadiness([makeCut()]);
    expect(issues.some((i) => i.includes("missing clean image"))).toBe(true);
  });

  it("reports not exported", () => {
    const { issues } = checkCartoonReadiness([makeCut({ cleanImagePath: "x.webp" })]);
    expect(issues.some((i) => i.includes("not exported"))).toBe(true);
  });

  it("reports no overlays", () => {
    const { issues } = checkCartoonReadiness([makeCut({ cleanImagePath: "x.webp", overlays: [] })]);
    expect(issues.some((i) => i.includes("no overlays"))).toBe(true);
  });

  it("reports missing export metadata", () => {
    const { issues } = checkCartoonReadiness([makeCut({ cleanImagePath: "x.webp", finalImagePath: "f.webp", overlays: [{ id: "1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }] })]);
    expect(issues.some((i) => i.includes("export metadata"))).toBe(true);
  });

  it("reports not uploaded", () => {
    const { issues } = checkCartoonReadiness([makeCut({
      cleanImagePath: "x.webp", finalImagePath: "f.webp", exportedAt: "2026-01-01",
      overlays: [{ id: "1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }],
    })]);
    expect(issues.some((i) => i.includes("not uploaded"))).toBe(true);
  });

  it("blank narration cut skips image checks", () => {
    const cuts = [makeCut({ narration: "Text only", uploadedUrl: "https://ipfs/Qm" })];
    const { ready } = checkCartoonReadiness(cuts);
    expect(ready).toBe(true);
  });
});

describe("checkMarkdownReadiness", () => {
  it("passes when all blocks present", () => {
    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![A](https://x)\n<!-- ows:cartoon-cut cut-001 end -->";
    const cuts = [makeCut({ uploadedUrl: "https://x" })];
    const { ready } = checkMarkdownReadiness(md, cuts);
    expect(ready).toBe(true);
  });

  it("reports missing block", () => {
    const { issues } = checkMarkdownReadiness("", [makeCut()]);
    expect(issues.some((i) => i.includes("missing or incomplete"))).toBe(true);
  });

  it("reports incomplete block (start only, no end)", () => {
    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![A](https://x)";
    const { issues } = checkMarkdownReadiness(md, [makeCut()]);
    expect(issues.some((i) => i.includes("missing or incomplete"))).toBe(true);
  });

  it("reports awaiting upload placeholders", () => {
    const md = "<!-- ows:cartoon-cut cut-001 start -->\n<!-- Cut 1: awaiting upload -->\n<!-- ows:cartoon-cut cut-001 end -->";
    const { issues } = checkMarkdownReadiness(md, [makeCut()]);
    expect(issues.some((i) => i.includes("awaiting-upload"))).toBe(true);
  });

  it("reports over 10K chars", () => {
    const md = "x".repeat(10001);
    const { issues } = checkMarkdownReadiness(md, []);
    expect(issues.some((i) => i.includes("10,000"))).toBe(true);
  });
});
