import { describe, it, expect } from "vitest";
import { checkCartoonReadiness, checkMarkdownReadiness, checkExportSize, isCartoonPlanningStage } from "./cartoon-readiness";
import { FONT_REGISTRY } from "./fonts";
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

  it("blocks local asset path image references", () => {
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![Cut 1](assets/plot-01/cut-01-final.webp)",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const cuts = [makeCut()];
    const { ready, issues } = checkMarkdownReadiness(md, cuts);
    expect(ready).toBe(false);
    expect(issues.some((i) => i.includes("not an http(s) URL"))).toBe(true);
  });

  it("blocks relative/dot-path image references", () => {
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![Cut 1](./cut-01.webp)",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const { ready } = checkMarkdownReadiness(md, [makeCut()]);
    expect(ready).toBe(false);
  });

  it("blocks 'final image pending' placeholder text", () => {
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      "final image pending",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const { ready, issues } = checkMarkdownReadiness(md, [makeCut()]);
    expect(ready).toBe(false);
    expect(issues.some((i) => i.includes("awaiting-upload"))).toBe(true);
  });

  it("passes for uploaded http image URLs", () => {
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![Cut 1](https://ipfs.example.com/QmAbc)",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const { ready } = checkMarkdownReadiness(md, [makeCut({ uploadedUrl: "https://ipfs.example.com/QmAbc" })]);
    expect(ready).toBe(true);
  });

  it("fails when cut.uploadedUrl is null even with a valid-looking URL in markdown", () => {
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![Cut 1](https://ipfs.filebase.io/ipfs/QmReal)",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const { ready, issues } = checkMarkdownReadiness(md, [makeCut({ uploadedUrl: null })]);
    expect(ready).toBe(false);
    expect(issues.some((i) => i.includes("not uploaded"))).toBe(true);
  });

  it("fails when block URL does not match recorded uploadedUrl", () => {
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![Cut 1](https://example.com/fake.webp)",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const { ready, issues } = checkMarkdownReadiness(md, [makeCut({ uploadedUrl: "https://ipfs.filebase.io/ipfs/QmA" })]);
    expect(ready).toBe(false);
    expect(issues.some((i) => i.includes("does not match the recorded uploaded URL"))).toBe(true);
  });

  it("passes only when block URL exactly equals recorded uploadedUrl", () => {
    const url = "https://ipfs.filebase.io/ipfs/QmExact";
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      `![Cut 1](${url})`,
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const { ready } = checkMarkdownReadiness(md, [makeCut({ uploadedUrl: url })]);
    expect(ready).toBe(true);
  });

  it("fails when a completed cut block has no image reference", () => {
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      "Just some text, no image",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const { ready, issues } = checkMarkdownReadiness(md, [makeCut({ uploadedUrl: "https://ipfs/QmA" })]);
    expect(ready).toBe(false);
    expect(issues.some((i) => i.includes("no image reference"))).toBe(true);
  });

  it("fails when a cut block has more than one image reference", () => {
    const url = "https://ipfs/QmA";
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      `![A](${url})`,
      `![B](${url})`,
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const { ready, issues } = checkMarkdownReadiness(md, [makeCut({ uploadedUrl: url })]);
    expect(ready).toBe(false);
    expect(issues.some((i) => i.includes("exactly one image reference"))).toBe(true);
  });

  it("fails when a stray image ref outside any cut block is not a recorded URL", () => {
    const url = "https://ipfs/QmA";
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      `![Cut 1](${url})`,
      "<!-- ows:cartoon-cut cut-001 end -->",
      "",
      "![sneaky](https://example.com/fake.webp)",
    ].join("\n");
    const { ready, issues } = checkMarkdownReadiness(md, [makeCut({ uploadedUrl: url })]);
    expect(ready).toBe(false);
    expect(issues.some((i) => i.includes("not a recorded uploaded cut URL"))).toBe(true);
  });

  it("fails when uploadedUrl is a local path matched by local markdown", () => {
    const localPath = "assets/plot-01/cut-01-final.webp";
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      `![Cut 1](${localPath})`,
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    // Bad recorded uploadedUrl that is NOT an http(s) URL; markdown matches it.
    const { ready, issues } = checkMarkdownReadiness(md, [makeCut({ uploadedUrl: localPath })]);
    expect(ready).toBe(false);
    expect(issues.some((i) => i.includes("not an http(s) URL"))).toBe(true);
  });

  it("fails when a duplicate cut block references a non-recorded URL", () => {
    const url = "https://ipfs/QmA";
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      `![Cut 1](${url})`,
      "<!-- ows:cartoon-cut cut-001 end -->",
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![dupe](https://example.com/fake2.webp)",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const { ready, issues } = checkMarkdownReadiness(md, [makeCut({ uploadedUrl: url })]);
    expect(ready).toBe(false);
    expect(issues.some((i) => i.includes("not a recorded uploaded cut URL"))).toBe(true);
  });
});

describe("isCartoonPlanningStage", () => {
  const block = (id: string, body: string) =>
    `<!-- ows:cartoon-cut ${id} start -->\n${body}\n<!-- ows:cartoon-cut ${id} end -->`;

  it("is true when cuts exist but markdown has no marker blocks", () => {
    const cuts = [makeCut(), makeCut({ id: 2 })];
    expect(isCartoonPlanningStage("# Episode 1\n\nplaceholder", cuts)).toBe(true);
  });

  it("is true when only some cuts have marker blocks", () => {
    const cuts = [makeCut(), makeCut({ id: 2 })];
    const md = block("cut-001", "<!-- Cut 1: awaiting upload -->");
    expect(isCartoonPlanningStage(md, cuts)).toBe(true);
  });

  it("is false when every cut has a marker block (even if not uploaded yet)", () => {
    const cuts = [makeCut(), makeCut({ id: 2 })];
    const md = [
      block("cut-001", "<!-- Cut 1: awaiting upload -->"),
      block("cut-002", "<!-- Cut 2: awaiting upload -->"),
    ].join("\n\n");
    expect(isCartoonPlanningStage(md, cuts)).toBe(false);
  });

  it("is false when there are no cuts", () => {
    expect(isCartoonPlanningStage("", [])).toBe(false);
  });
});

describe("checkExportSize", () => {
  it("passes for file under 1MB", () => {
    expect(checkExportSize(500 * 1024)).toBeNull();
  });

  it("passes for file at exactly 1MB", () => {
    expect(checkExportSize(1024 * 1024)).toBeNull();
  });

  it("fails for file over 1MB", () => {
    const result = checkExportSize(1024 * 1024 + 1);
    expect(result).toContain("1MB");
  });
});

describe("font/package size impact", () => {
  it("no vendored font files — all fonts use CDN", () => {
    for (const font of FONT_REGISTRY) {
      expect(font.googleFontsId).toBeTruthy();
      expect(font.license).toBe("OFL-1.1");
    }
  });

  it("font registry is small (under 10 entries for MVP)", () => {
    expect(FONT_REGISTRY.length).toBeLessThanOrEqual(10);
  });
});
