import { describe, it, expect } from "vitest";
import { checkCartoonReadiness, checkMarkdownReadiness, checkExportSize, isCartoonPlanningStage, classifyCartoonReadiness, summarizeCutProgress, cartoonChecklist } from "./cartoon-readiness";
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
    const prose = issues.find((i) => i.includes("placeholder/instructional"))!;
    expect(prose).toBeDefined();
    // Writer-facing action name — no "Generate MD" or "Markdown" jargon (#320, #335).
    expect(prose).toContain("Prepare episode for publish");
    expect(prose).not.toMatch(/Generate MD\b/);
    expect(prose).not.toMatch(/Markdown/);
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
    expect(issues.some((i) => i.includes("placeholder/instructional"))).toBe(true);
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
    expect(result.issues.some((i) => i.includes("placeholder/instructional"))).toBe(true);
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

describe("summarizeCutProgress (#335)", () => {
  const full = (id: number): Partial<Cut> => ({
    id,
    cleanImagePath: "c.webp",
    overlays: [{ id: `o${id}`, type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }],
    finalImagePath: "f.webp",
    exportedAt: "2026-01-01",
    uploadedUrl: `https://ipfs/Qm${id}`,
  });

  it("counts per-cut progress across the production fields", () => {
    const cuts = [
      makeCut(full(1)),
      makeCut({ id: 2, cleanImagePath: "c.webp", overlays: [{ id: "o2", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }] }), // clean + text, not exported/uploaded
      makeCut({ id: 3, cleanImagePath: "c.webp" }), // clean only, no text
      makeCut({ id: 4 }), // nothing — needs a clean image
    ];
    const p = summarizeCutProgress(cuts);
    expect(p).toEqual({ total: 4, needClean: 4, withClean: 3, withText: 2, exported: 1, uploaded: 1 });
  });

  it("treats a narration-only cut as not needing a clean image, but still countable for upload", () => {
    const cuts = [makeCut({ id: 1, narration: "Later that night...", uploadedUrl: "https://ipfs/QmN" })];
    const p = summarizeCutProgress(cuts);
    expect(p.needClean).toBe(0);
    expect(p.total).toBe(1);
    expect(p.uploaded).toBe(1);
  });
});

describe("cartoonChecklist (#335)", () => {
  const keys = (r: { steps: { key: string }[] }) => r.steps.map((s) => s.key);
  const statusOf = (r: { steps: { key: string; status: string }[] }, key: string) =>
    r.steps.find((s) => s.key === key)!.status;
  const full = (id: number): Partial<Cut> => ({
    id,
    cleanImagePath: "c.webp",
    overlays: [{ id: `o${id}`, type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }],
    finalImagePath: "f.webp",
    exportedAt: "2026-01-01",
    uploadedUrl: `https://ipfs/Qm${id}`,
  });

  it("returns no steps for an empty plan (non-cartoon / unparsed)", () => {
    const r = cartoonChecklist({ cuts: [] });
    expect(r.steps).toEqual([]);
    expect(r.nextStep).toBeNull();
  });

  it("lists the six production steps in order with writer-facing labels (no jargon)", () => {
    const r = cartoonChecklist({ cuts: [makeCut({ cleanImagePath: "c.webp" })] });
    expect(keys(r)).toEqual(["plan", "clean", "letter", "export", "upload", "publish"]);
    const labels = r.steps.map((s) => s.label).join(" | ");
    expect(labels).not.toMatch(/generate md|markdown|cuts\.json/i);
  });

  it("with only a cut plan: plan done, create-clean-images is current", () => {
    const r = cartoonChecklist({ cuts: [makeCut({ id: 1 }), makeCut({ id: 2 })] });
    expect(statusOf(r, "plan")).toBe("done");
    expect(statusOf(r, "clean")).toBe("current");
    expect(statusOf(r, "publish")).toBe("todo");
    expect(r.nextStep).toMatch(/clean image for each cut/i);
    expect(r.steps.find((s) => s.key === "clean")!.detail).toBe("0 / 2 cuts");
  });

  it("clean images done, lettering current", () => {
    const cuts = [makeCut({ id: 1, cleanImagePath: "c.webp" }), makeCut({ id: 2, cleanImagePath: "c.webp" })];
    const r = cartoonChecklist({ cuts });
    expect(statusOf(r, "clean")).toBe("done");
    expect(statusOf(r, "letter")).toBe("current");
    expect(r.nextStep).toMatch(/lettering editor|speech bubbles/i);
  });

  it("all uploaded but unpublished: publish is current", () => {
    const r = cartoonChecklist({ cuts: [makeCut(full(1)), makeCut(full(2))], published: false });
    expect(statusOf(r, "upload")).toBe("done");
    expect(statusOf(r, "publish")).toBe("current");
    expect(r.nextStep).toMatch(/preview the episode, then publish/i);
  });

  it("published: every step done", () => {
    const r = cartoonChecklist({ cuts: [makeCut(full(1))], published: true });
    expect(r.steps.every((s) => s.status === "done")).toBe(true);
    expect(r.nextStep).toMatch(/live on plotlink/i);
  });
});
