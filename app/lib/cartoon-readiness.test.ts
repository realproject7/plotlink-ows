import { describe, it, expect } from "vitest";
import { checkCartoonReadiness, checkMarkdownReadiness, checkExportSize, isCartoonPlanningStage, classifyCartoonReadiness, cartoonWorkflowSteps } from "./cartoon-readiness";
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

describe("classifyCartoonReadiness", () => {
  const block = (id: string, body: string) =>
    `<!-- ows:cartoon-cut ${id} start -->\n${body}\n<!-- ows:cartoon-cut ${id} end -->`;

  it("classifies all-awaiting blocks as awaiting-upload (no issues)", () => {
    const cuts = [makeCut(), makeCut({ id: 2 })];
    const md = [
      block("cut-001", "<!-- Cut 1: awaiting upload -->"),
      block("cut-002", "<!-- Cut 2: awaiting upload -->"),
    ].join("\n\n");
    const result = classifyCartoonReadiness(md, cuts);
    expect(result.stage).toBe("awaiting-upload");
    expect(result.issues).toEqual([]);
    expect(result.awaitingCount).toBe(2);
    expect(result.totalCuts).toBe(2);
  });

  it("classifies malformed markdown as error with the real issue present", () => {
    const url = "https://ipfs/QmA";
    const md = block("cut-001", `![A](${url})\n![B](${url})`);
    const result = classifyCartoonReadiness(md, [makeCut({ uploadedUrl: url })]);
    expect(result.stage).toBe("error");
    expect(result.issues.some((i) => i.includes("exactly one image reference"))).toBe(true);
  });

  it("classifies fully uploaded markdown as ready", () => {
    const url = "https://ipfs/Qm";
    const md = block("cut-001", `![Scene](${url})`);
    const result = classifyCartoonReadiness(md, [makeCut({ uploadedUrl: url })]);
    expect(result.stage).toBe("ready");
    expect(result.issues).toEqual([]);
  });

  it("classifies a missing cut block as planning", () => {
    const cuts = [makeCut(), makeCut({ id: 2 })];
    const md = block("cut-001", "<!-- Cut 1: awaiting upload -->");
    const result = classifyCartoonReadiness(md, cuts);
    expect(result.stage).toBe("planning");
    expect(result.issues).toEqual([]);
    expect(result.awaitingCount).toBe(0);
  });

  it("reports only the real issue when awaiting mixes with a malformed cut", () => {
    const url = "https://ipfs/QmB";
    const cuts = [makeCut(), makeCut({ id: 2, uploadedUrl: url })];
    const md = [
      block("cut-001", "<!-- Cut 1: awaiting upload -->"),
      block("cut-002", `![A](${url})\n![B](${url})`),
    ].join("\n\n");
    const result = classifyCartoonReadiness(md, cuts);
    expect(result.stage).toBe("error");
    expect(result.issues).toEqual([
      "Cut 2: block must contain exactly one image reference",
    ]);
  });
});

describe("checkMarkdownReadiness — placeholder prose (#286)", () => {
  const block = (id: string, url: string) =>
    `<!-- ows:cartoon-cut ${id} start -->\n![Scene](${url})\n<!-- ows:cartoon-cut ${id} end -->`;
  // The exact prose that leaked on-chain in storyline #57 / plot 1.
  const PILOT_PROSE =
    "Placeholder only. OWS should generate the publish markdown from `plot-01.cuts.json` after clean images are approved, lettered final images are created, and final images are uploaded.";

  it("rejects placeholder prose BEFORE the first cut block", () => {
    const url = "https://ipfs/QmA";
    const md = `${PILOT_PROSE}\n\n${block("cut-001", url)}`;
    const { ready, issues } = checkMarkdownReadiness(md, [makeCut({ uploadedUrl: url })]);
    expect(ready).toBe(false);
    const prose = issues.find((i) => i.includes("placeholder/instructional prose"))!;
    expect(prose).toBeDefined();
    // Creator-facing action name, not the old "Generate MD" jargon (#320).
    expect(prose).toContain("re-run Prepare Publish Markdown");
    expect(prose).not.toMatch(/Generate MD\b/);
  });

  it("rejects placeholder prose BETWEEN/AFTER cut blocks", () => {
    const url = "https://ipfs/QmA";
    const md = [
      block("cut-001", url),
      "OWS should generate the publish markdown from cuts.json after clean images are approved.",
      block("cut-002", url),
    ].join("\n\n");
    const cuts = [makeCut({ uploadedUrl: url }), makeCut({ id: 2, uploadedUrl: url })];
    const { ready, issues } = checkMarkdownReadiness(md, cuts);
    expect(ready).toBe(false);
    expect(issues.some((i) => i.includes("placeholder/instructional prose"))).toBe(true);
  });

  it("rejects generic template leftovers (TODO/FIXME)", () => {
    const url = "https://ipfs/QmA";
    const md = `TODO: replace this episode intro\n\n${block("cut-001", url)}`;
    const { ready } = checkMarkdownReadiness(md, [makeCut({ uploadedUrl: url })]);
    expect(ready).toBe(false);
  });

  it("passes for normal image-only cartoon markdown (no placeholder prose)", () => {
    const url = "https://ipfs/QmA";
    const md = [block("cut-001", url), block("cut-002", url)].join("\n\n");
    const cuts = [makeCut({ uploadedUrl: url }), makeCut({ id: 2, uploadedUrl: url })];
    const { ready, issues } = checkMarkdownReadiness(md, cuts);
    expect(ready).toBe(true);
    expect(issues).toEqual([]);
  });

  it("classifyCartoonReadiness surfaces placeholder prose as an error (publish blocked)", () => {
    const url = "https://ipfs/QmA";
    const md = `${PILOT_PROSE}\n\n${block("cut-001", url)}`;
    const result = classifyCartoonReadiness(md, [makeCut({ uploadedUrl: url })]);
    expect(result.stage).toBe("error");
    expect(result.issues.some((i) => i.includes("placeholder/instructional prose"))).toBe(true);
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

describe("cartoonWorkflowSteps (#320)", () => {
  const keys = (r: { steps: { key: string }[] }) => r.steps.map((s) => s.key);
  const statusOf = (r: { steps: { key: string; status: string }[] }, key: string) =>
    r.steps.find((s) => s.key === key)!.status;

  it("returns no steps and no next step for an unknown stage", () => {
    const r = cartoonWorkflowSteps({ stage: null, awaitingCount: 0, totalCuts: 0 });
    expect(r.steps).toEqual([]);
    expect(r.nextStep).toBeNull();
  });

  it("always lists the four milestones in production order", () => {
    const r = cartoonWorkflowSteps({ stage: "planning", awaitingCount: 0, totalCuts: 3 });
    expect(keys(r)).toEqual(["plan", "markdown", "images", "publish"]);
  });

  it("uses creator-facing labels, not internal jargon", () => {
    const r = cartoonWorkflowSteps({ stage: "planning", awaitingCount: 0, totalCuts: 1 });
    const labels = r.steps.map((s) => s.label).join(" | ");
    expect(labels).not.toMatch(/generate md|markdown skeleton|cuts\.json/i);
    expect(r.steps.find((s) => s.key === "markdown")!.label).toBe("Prepare episode for publish");
  });

  it("planning: prepare-markdown is current, publish is todo", () => {
    const r = cartoonWorkflowSteps({ stage: "planning", awaitingCount: 0, totalCuts: 2 });
    expect(statusOf(r, "plan")).toBe("done");
    expect(statusOf(r, "markdown")).toBe("current");
    expect(statusOf(r, "images")).toBe("todo");
    expect(statusOf(r, "publish")).toBe("todo");
    expect(r.nextStep).toMatch(/prepare the episode for publish/i);
  });

  it("awaiting-upload: images is current and the next step counts remaining uploads", () => {
    const r = cartoonWorkflowSteps({ stage: "awaiting-upload", awaitingCount: 2, totalCuts: 5 });
    expect(statusOf(r, "markdown")).toBe("done");
    expect(statusOf(r, "images")).toBe("current");
    expect(statusOf(r, "publish")).toBe("todo");
    expect(r.nextStep).toMatch(/2 of 5 cuts still need an uploaded image/i);
  });

  it("ready: publish is the current step", () => {
    const r = cartoonWorkflowSteps({ stage: "ready", awaitingCount: 0, totalCuts: 4 });
    expect(statusOf(r, "images")).toBe("done");
    expect(statusOf(r, "publish")).toBe("current");
    expect(r.nextStep).toMatch(/preview the episode, then publish/i);
  });

  it("error: points to the issues to resolve", () => {
    const r = cartoonWorkflowSteps({ stage: "error", awaitingCount: 0, totalCuts: 3 });
    expect(r.nextStep).toMatch(/resolve the publish issues/i);
  });
});
