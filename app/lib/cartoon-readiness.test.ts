import { describe, it, expect } from "vitest";
import { checkCartoonReadiness, checkMarkdownReadiness, checkExportSize, isCartoonPlanningStage, classifyCartoonReadiness, summarizeCutProgress, cartoonChecklist, cartoonGenesisReadiness, groupCartoonIssues, previewFooterGuidance, cartoonPublishVerdict, type CartoonCutProgress } from "./cartoon-readiness";
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

  it("reports stale tailed exports that must be re-exported before publish (#389)", () => {
    const { ready, issues } = checkCartoonReadiness([makeCut({
      cleanImagePath: "x.webp",
      finalImagePath: "f.webp",
      exportedAt: "2026-01-01",
      uploadedCid: "Qm",
      uploadedUrl: "https://ipfs/Qm",
      overlays: [{ id: "1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi", tailAnchor: { x: 0.5, y: 1.2 } }],
      // No finalRendererVersion stamp => pre-#381 export, treated as stale.
    })]);
    expect(ready).toBe(false);
    expect(issues).toContain(
      "Cut 1: re-export required before publish — this final image uses an older speech-bubble tail style that can show a visible seam",
    );
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
    // Use a real (1-cut) plan: a 0-cut plan now fails closed before the size
    // check (#422), and the size limit applies to actual episodes anyway.
    const { issues } = checkMarkdownReadiness(md, [makeCut()]);
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

  it("blocks stale tailed exports even when markdown and uploaded URL look valid (#389)", () => {
    const url = "https://ipfs.example.com/QmAbc";
    const md = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      `![Cut 1](${url})`,
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const { ready, issues } = checkMarkdownReadiness(md, [makeCut({
      uploadedUrl: url,
      uploadedCid: "QmAbc",
      finalImagePath: "assets/plot-01/cut-01-final.webp",
      exportedAt: "2026-01-01",
      overlays: [{ id: "1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi", tailAnchor: { x: 0.5, y: 1.2 } }],
    })]);
    expect(ready).toBe(false);
    expect(issues).toContain(
      "Cut 1: re-export required before publish — this final image uses an older speech-bubble tail style that can show a visible seam",
    );
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

  it("classifies stale tailed exports as an error even with otherwise-valid markdown (#389)", () => {
    const url = "https://ipfs/QmA";
    const md = block("cut-001", `![A](${url})`);
    const result = classifyCartoonReadiness(md, [makeCut({
      uploadedUrl: url,
      uploadedCid: "QmA",
      finalImagePath: "assets/plot-01/cut-01-final.webp",
      exportedAt: "2026-01-01",
      overlays: [{ id: "1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi", tailAnchor: { x: 0.5, y: 1.2 } }],
    })]);
    expect(result.stage).toBe("error");
    expect(result.issues).toEqual([
      "Cut 1: re-export required before publish — this final image uses an older speech-bubble tail style that can show a visible seam",
    ]);
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

  it("counts EVERY cut as image-required for MVP, incl. a narrated/dialogue cut (#338 fix)", () => {
    // A planned cut carries narration/dialogue before any art exists — it must
    // still be counted as needing a clean image, not inferred as narration-only.
    const cuts = [makeCut({ id: 1, narration: "Later that night...", dialogue: [{ speaker: "A", text: "Hi" }] })];
    const p = summarizeCutProgress(cuts);
    expect(p.needClean).toBe(1);
    expect(p.total).toBe(1);
    expect(p.withClean).toBe(0); // no clean image yet
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

  // #442: lettering is a first-class progress step. Its state must move from
  // current → done as overlays are placed (before/after overlays exist).
  it("(#442) the 'Add speech bubbles & captions' step is current after clean art, done once overlays exist", () => {
    const before = cartoonChecklist({ cuts: [makeCut({ id: 1, cleanImagePath: "c.webp", overlays: [] })] });
    expect(before.steps.find((s) => s.key === "letter")!.label).toMatch(/speech bubbles/i);
    expect(statusOf(before, "clean")).toBe("done");
    expect(statusOf(before, "letter")).toBe("current");

    const after = cartoonChecklist({ cuts: [makeCut({ id: 1, cleanImagePath: "c.webp", overlays: [{ id: "o1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }] })] });
    expect(statusOf(after, "letter")).toBe("done");
    expect(statusOf(after, "export")).toBe("current");
  });

  it("with only a cut plan: plan done, create-clean-images is current", () => {
    const r = cartoonChecklist({ cuts: [makeCut({ id: 1 }), makeCut({ id: 2 })] });
    expect(statusOf(r, "plan")).toBe("done");
    expect(statusOf(r, "clean")).toBe("current");
    expect(statusOf(r, "publish")).toBe("todo");
    expect(r.nextStep).toMatch(/clean image for each cut/i);
    expect(r.steps.find((s) => s.key === "clean")!.detail).toBe("0 / 2 cuts");
  });

  // #338 operator finding: a planned cut WITH narration/dialogue but no clean
  // image must still show "Create clean images" as current at 0/1 — it must not
  // be treated as a no-image narration-only cut that skips straight to upload.
  it("a planned narrated/dialogue cut with null cleanImagePath shows Create clean images current at 0/1", () => {
    const r = cartoonChecklist({
      cuts: [makeCut({ id: 1, cleanImagePath: null, narration: "Dawn.", dialogue: [{ speaker: "Mira", text: "We're here." }] })],
    });
    expect(statusOf(r, "clean")).toBe("current");
    expect(r.steps.find((s) => s.key === "clean")!.detail).toBe("0 / 1 cut");
    expect(statusOf(r, "upload")).toBe("todo");
    expect(r.nextStep).toMatch(/clean image for each cut/i);
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

describe("text panels (#350)", () => {
  const imageDone = (id: number): Partial<Cut> => ({
    id, cleanImagePath: "c.webp",
    overlays: [{ id: `o${id}`, type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }],
    finalImagePath: "f.webp", exportedAt: "2026-01-01", uploadedUrl: `https://ipfs/Qm${id}`,
  });

  it("summarizeCutProgress excludes text panels from needClean but counts their export/upload", () => {
    const cuts = [
      makeCut(imageDone(1)),
      makeCut({ id: 2, kind: "text", finalImagePath: "t.webp", exportedAt: "2026-01-01", uploadedUrl: "https://ipfs/QmT" }),
    ];
    const p = summarizeCutProgress(cuts);
    expect(p.total).toBe(2);
    expect(p.needClean).toBe(1); // only the image cut
    expect(p.withClean).toBe(1);
    expect(p.withText).toBe(1); // the image cut is lettered; the empty text panel is not
    expect(p.exported).toBe(2); // both panels exported
    expect(p.uploaded).toBe(2);
  });

  it("a planned text panel never reports 'missing clean image' (checkCartoonReadiness)", () => {
    const cuts = [makeCut({ id: 1, kind: "text" })];
    const { issues } = checkCartoonReadiness(cuts);
    expect(issues.some((i) => /missing clean image/.test(i))).toBe(false);
    // It still needs export + upload before publish.
    expect(issues).toContain("Cut 1: not exported");
    expect(issues).toContain("Cut 1: not uploaded");
  });

  it("a fully-prepared text panel is ready (no clean image required)", () => {
    const cuts = [makeCut({ id: 1, kind: "text", finalImagePath: "t.webp", exportedAt: "2026-01-01", uploadedCid: "Qm", uploadedUrl: "https://ipfs/QmT" })];
    expect(checkCartoonReadiness(cuts).ready).toBe(true);
  });

  it("cartoonChecklist: an all-text episode skips clean but still requires text-card lettering", () => {
    const r = cartoonChecklist({ cuts: [makeCut({ id: 1, kind: "text" })] });
    const statusOf = (k: string) => r.steps.find((s) => s.key === k)!.status;
    expect(statusOf("clean")).toBe("done"); // no image cuts to clean
    expect(statusOf("letter")).toBe("current");
    expect(statusOf("export")).toBe("todo");
    expect(r.steps.find((s) => s.key === "clean")!.detail).toBe("no image cuts");
    expect(r.steps.find((s) => s.key === "letter")!.detail).toBe("0 / 1 cut");
    expect(r.nextStep).toMatch(/lettering editor|speech bubbles/i);
  });

  it("cartoonChecklist: a mixed plan still gates clean on the image cut", () => {
    const cuts = [makeCut({ id: 1 /* image, no clean */ }), makeCut({ id: 2, kind: "text" })];
    const r = cartoonChecklist({ cuts });
    const statusOf = (k: string) => r.steps.find((s) => s.key === k)!.status;
    expect(statusOf("clean")).toBe("current");
    expect(r.steps.find((s) => s.key === "clean")!.detail).toBe("0 / 1 cut");
  });

  it("cartoonChecklist: an empty text panel keeps lettering current even after image cuts are lettered (#488 re2)", () => {
    const cuts = [
      makeCut(imageDone(1)),
      makeCut({ id: 2, kind: "text", overlays: [] }),
    ];
    const r = cartoonChecklist({ cuts });
    const statusOf = (k: string) => r.steps.find((s) => s.key === k)!.status;
    expect(statusOf("clean")).toBe("done");
    expect(statusOf("letter")).toBe("current");
    expect(statusOf("export")).toBe("todo");
    expect(r.steps.find((s) => s.key === "letter")!.detail).toBe("1 / 2 cuts");
    expect(r.nextStep).toMatch(/lettering editor|speech bubbles/i);
  });
});

describe("cartoonGenesisReadiness (#359, hardened in #400)", () => {
  // A reader-facing prologue: a real title + a couple of prose paragraphs of setup.
  const goodOpening = [
    "# Coupon Crush at Closing Time",
    "",
    "The mall's last fluorescent light buzzes overhead as Mina slaps her final clearance sticker on a rack of forgotten umbrellas. She has nine minutes to hit her quota or lose the bonus that covers rent — and the only customer left is the smug rival cashier from the kiosk across the hall.",
    "",
    "He grins, holding up a coupon she's never seen before. Game on.",
  ].join("\n");

  it("passes a real reader-facing opening (title + multi-paragraph prose, no blockers/warnings)", () => {
    const r = cartoonGenesisReadiness(goodOpening);
    expect(r.hasTitle).toBe(true);
    expect(r.blockers).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("passes a 3-6 paragraph story-opening prologue with a real title", () => {
    const prologue = [
      "# Signal Lost Over Neo-Busan",
      "",
      "Rain sheets across the megastack as Jin pries open a maintenance hatch forty floors above the flooded streets, the city's neon bleeding through the storm.",
      "",
      "She has one job tonight: splice the old broadcast tower before the syndicate's blackout goes live and swallows the last free channel in the district.",
      "",
      "But the wiring is already warm — someone got here first, and the access log shows her own ID badge, used twenty minutes ago.",
      "",
      "Down in the dark, something answers the dead frequency. Episode 01 starts the moment she keys the mic.",
    ].join("\n");
    const r = cartoonGenesisReadiness(prologue);
    expect(r.hasTitle).toBe(true);
    expect(r.blockers).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("blocks a Genesis with no H1 title", () => {
    const r = cartoonGenesisReadiness("Mina races the clock to hit her quota before the mall closes for good, and the only person left is her smug rival. " + "x".repeat(150));
    expect(r.hasTitle).toBe(false);
    expect(r.blockers.some((b) => /# Title/.test(b))).toBe(true);
  });

  it("treats an H1 with only whitespace as no title", () => {
    expect(cartoonGenesisReadiness("#   \n\nbody").hasTitle).toBe(false);
  });

  it("blocks (not warns) when the opening is too short", () => {
    const r = cartoonGenesisReadiness("# Coupon Crush\n\nMina has nine minutes.");
    expect(r.warnings).toHaveLength(0);
    expect(r.blockers.some((b) => /too short/i.test(b))).toBe(true);
  });

  it("blocks when the Genesis reads like a metadata synopsis/outline, not prose", () => {
    const synopsis = [
      "# Coupon Crush",
      "",
      "Genre: Romantic comedy",
      "Logline: Two rival cashiers fall for each other during a closing-time coupon war.",
      "Setting: A dying suburban mall, present day, over one frantic evening shift.",
      "Characters: Mina (driven, broke), Theo (smug rival), the Manager (counting down).",
      "Tone: Warm, fast, a little chaotic — cute webtoon energy throughout the run.",
    ].join("\n");
    const r = cartoonGenesisReadiness(synopsis);
    expect(r.hasTitle).toBe(true);
    expect(r.warnings).toHaveLength(0);
    expect(r.blockers.some((b) => /synopsis or outline/i.test(b))).toBe(true);
  });

  it("blocks when a long body is only bullet points (no opening scene)", () => {
    const bullets = [
      "# Coupon Crush",
      "",
      "- Mina needs the bonus to make rent this month or she is out on the street",
      "- Theo is the smug rival cashier from the kiosk across the hall, always winning",
      "- The mall closes for good tonight and the manager is counting down the minutes",
      "- A mysterious coupon could decide the whole closing-time standoff between them",
    ].join("\n");
    const r = cartoonGenesisReadiness(bullets);
    expect(r.warnings).toHaveLength(0);
    expect(r.blockers.some((b) => /synopsis or outline/i.test(b))).toBe(true);
  });

  // #380/#400: a long single block of prose passes the length + synopsis-shape
  // checks but reads as a cold open — block, since the opening needs buildup
  // across a few short paragraphs that lead into Episode 01.
  it("blocks when real prose is a single dense block (no buildup) (#380/#400)", () => {
    const oneBlock =
      "# Coupon Crush at Closing Time\n\n" +
      "The mall's last fluorescent light buzzes as Mina slaps a clearance sticker on a rack of umbrellas, nine minutes to hit her quota or lose the bonus that covers rent, while the smug rival cashier from the kiosk across the hall grins and holds up a coupon she has never seen before and the standoff begins right there.";
    const r = cartoonGenesisReadiness(oneBlock);
    expect(r.warnings).toHaveLength(0);
    expect(r.blockers.some((b) => /synopsis or outline/i.test(b))).toBe(false);
    expect(r.blockers.some((b) => /room to build|buildup|short paragraphs|single dense block/i.test(b))).toBe(true);
  });

  it("does NOT block on buildup for a multi-paragraph prologue (#380)", () => {
    const prologue = [
      "# Coupon Crush at Closing Time",
      "",
      "The mall's last fluorescent light buzzes overhead as Mina slaps her final clearance sticker on a rack of forgotten umbrellas, nine minutes to hit her quota.",
      "",
      "She needs the closing bonus to make rent — and she is not about to lose it to the smug rival cashier from the kiosk across the hall.",
      "",
      "He grins, holding up a coupon she has never seen before. Game on, and the mall's last night just got interesting.",
    ].join("\n");
    const r = cartoonGenesisReadiness(prologue);
    expect(r.blockers).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });
});

describe("groupCartoonIssues (#360)", () => {
  it("groups flat readiness issues by workflow step", () => {
    const groups = groupCartoonIssues([
      "Cut 1: not uploaded (no recorded uploaded URL)",
      "Cut 3: not uploaded (no recorded uploaded URL)",
      "Cut 2: missing or incomplete markdown block",
      "Markdown is 10001 chars (limit 10,000)",
    ]);
    const keys = groups.map((g) => g.key);
    // Ordered by workflow: assemble before upload before size.
    expect(keys).toEqual(["assemble", "upload", "size"]);
    expect(groups.find((g) => g.key === "upload")!.title).toBe("Upload final images");
  });

  it("collapses repeated per-cut reasons into one line ('Cuts 1, 3, 5')", () => {
    const groups = groupCartoonIssues([
      "Cut 1: not uploaded (no recorded uploaded URL)",
      "Cut 5: not uploaded (no recorded uploaded URL)",
      "Cut 3: not uploaded (no recorded uploaded URL)",
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toEqual(["Cuts 1, 3, 5: not uploaded (no recorded uploaded URL)"]);
  });

  it("keeps a single cut as 'Cut N' (not 'Cuts N')", () => {
    const groups = groupCartoonIssues(["Cut 2: missing or incomplete markdown block"]);
    expect(groups[0].lines).toEqual(["Cut 2: missing or incomplete markdown block"]);
  });

  it("routes leftover-text and image-reference issues to their own steps", () => {
    const groups = groupCartoonIssues([
      "This episode still has placeholder/instructional text (\"Placeholder only\") — remove it",
      "Image reference is not a recorded uploaded cut URL: https://x",
    ]);
    expect(groups.map((g) => g.key).sort()).toEqual(["cleanup", "images"]);
  });

  it("puts unrecognized issues in an 'Other issues' group and drops nothing", () => {
    const groups = groupCartoonIssues(["Some brand new failure mode"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("other");
    expect(groups[0].title).toBe("Other issues");
    expect(groups[0].lines).toEqual(["Some brand new failure mode"]);
  });

  it("returns no groups for an empty issue list", () => {
    expect(groupCartoonIssues([])).toEqual([]);
  });
});

describe("checkMarkdownReadiness — zero cuts fails closed (#422)", () => {
  it("is never ready with an empty cut plan, even when the markdown has no other issue", () => {
    const { ready, issues } = checkMarkdownReadiness("# Episode 2\n\nA clean placeholder.", []);
    expect(ready).toBe(false);
    expect(issues.some((i) => /no cuts planned yet/i.test(i))).toBe(true);
  });
});

describe("classifyCartoonReadiness — not-started placeholder (#422)", () => {
  it("classifies an empty cut plan as not-started, not error, regardless of placeholder prose", () => {
    // A scaffold placeholder plot-NN.md: instructional prose, empty cuts: [].
    const md = "# Episode 2\n\nPlaceholder only. OWS generates the publish markdown from plot-02.cuts.json.";
    const report = classifyCartoonReadiness(md, []);
    expect(report.stage).toBe("not-started");
    expect(report.issues).toEqual([]);
    expect(report.totalCuts).toBe(0);
  });

  it("a plan with cuts is still classified by the normal stages (not-started is 0-cuts only)", () => {
    const md = "# Ep\n\nno blocks yet";
    expect(classifyCartoonReadiness(md, [makeCut()]).stage).toBe("planning");
  });
});

describe("cartoonPublishVerdict — possible vs recommended (#421)", () => {
  it("ready ⇒ publish possible AND recommended, no action", () => {
    const v = cartoonPublishVerdict({ stage: "ready", imageCount: 3, hasNonImageProse: false });
    expect(v.possible).toBe(true);
    expect(v.recommended).toBe(true);
    expect(v.headline).toMatch(/Ready to publish/i);
    expect(v.action).toBeNull();
  });

  it("zero images + prose ⇒ not possible, not recommended, placeholder framing + prepare action", () => {
    // The pilot's plot-NN.md "Episode 2 placeholder" — must never read as ready.
    for (const stage of ["not-started", "planning", "error"] as const) {
      const v = cartoonPublishVerdict({ stage, imageCount: 0, hasNonImageProse: true });
      expect(v.possible).toBe(false);
      expect(v.recommended).toBe(false);
      expect(v.tone).toBe("warning");
      expect(v.headline).toMatch(/planning\/placeholder text/i);
      expect(v.action).toMatch(/Prepare episode for publish/i);
    }
  });

  it("not-started (no prose) is a calm info state, not a blocker", () => {
    const v = cartoonPublishVerdict({ stage: "not-started", imageCount: 0, hasNonImageProse: false });
    expect(v.possible).toBe(false);
    expect(v.tone).toBe("info");
    expect(v.headline).toMatch(/Not started/i);
  });

  it("error (with images) is a hard blocker pointing at the technical details", () => {
    const v = cartoonPublishVerdict({ stage: "error", imageCount: 2, hasNonImageProse: false });
    expect(v.possible).toBe(false);
    expect(v.tone).toBe("blocker");
    expect(v.headline).toMatch(/Not publishable/i);
    expect(v.action).toMatch(/technical details/i);
  });

  it("awaiting-upload is possible:false but a calm waiting state", () => {
    const v = cartoonPublishVerdict({ stage: "awaiting-upload", imageCount: 1, hasNonImageProse: false });
    expect(v.possible).toBe(false);
    expect(v.recommended).toBe(false);
    expect(v.tone).toBe("info");
    expect(v.action).toMatch(/Upload the remaining final images/i);
  });
});

describe("previewFooterGuidance (#422)", () => {
  const base = { hasGenesis: false, isPublished: false, cutCount: null as number | null };
  const prog = (o: Partial<CartoonCutProgress>): CartoonCutProgress => ({ total: 4, needClean: 4, withClean: 0, withText: 0, exported: 0, uploaded: 0, ...o });

  it("fiction structure.md keeps the original outline line unchanged", () => {
    expect(previewFooterGuidance({ ...base, fileName: "structure.md", contentType: "fiction" }))
      .toBe("This is your story outline — not publishable. Ask AI to write the genesis next.");
    // Even when a genesis exists, fiction is unchanged.
    expect(previewFooterGuidance({ ...base, fileName: "structure.md", contentType: "fiction", hasGenesis: true }))
      .toBe("This is your story outline — not publishable. Ask AI to write the genesis next.");
  });

  it("cartoon structure.md distinguishes Genesis-missing from Genesis-exists", () => {
    const missing = previewFooterGuidance({ ...base, fileName: "structure.md", contentType: "cartoon", hasGenesis: false });
    const exists = previewFooterGuidance({ ...base, fileName: "structure.md", contentType: "cartoon", hasGenesis: true });
    expect(missing).toMatch(/Write the Genesis opening/i);
    expect(exists).toMatch(/review its opening and cuts/i);
    expect(exists).not.toBe(missing);
  });

  it("cartoon genesis with no cuts suggests planning cuts", () => {
    expect(previewFooterGuidance({ ...base, fileName: "genesis.md", contentType: "cartoon", cutCount: 0 }))
      .toMatch(/Plan its cuts/i);
  });

  // #451: the Genesis footer must advance by the real production stage — clean
  // art → lettering → export → upload — not say "generate clean images" whenever
  // nothing is uploaded.
  it("advances the Genesis footer by production stage (clean → letter → export → upload)", () => {
    const g = (p: CartoonCutProgress) =>
      previewFooterGuidance({ ...base, fileName: "genesis.md", contentType: "cartoon", cutCount: p.total, cutProgress: p });
    // No clean art yet → generate clean images.
    expect(g(prog({ withClean: 0 }))).toMatch(/generate the clean images/i);
    // Clean art present but not lettered → add speech bubbles, NOT "generate clean images".
    const lettering = g(prog({ withClean: 4, withText: 0 }));
    expect(lettering).toMatch(/clean art is ready.*speech bubbles/i);
    expect(lettering).not.toMatch(/generate.*clean images/i);
    // Lettered, not exported → export.
    expect(g(prog({ withClean: 4, withText: 4, exported: 0 }))).toMatch(/export the final images/i);
    // Exported, not uploaded → upload.
    expect(g(prog({ withClean: 4, withText: 4, exported: 4, uploaded: 0 }))).toMatch(/upload them/i);
    // Every cut uploaded → no footer nudge (publish controls take over).
    expect(g(prog({ withClean: 4, withText: 4, exported: 4, uploaded: 4 }))).toBeNull();
  });

  it("a future-episode placeholder plot (empty cuts) says it hasn't been started", () => {
    expect(previewFooterGuidance({ ...base, fileName: "plot-02.md", contentType: "cartoon", cutCount: 0 }))
      .toMatch(/hasn't been started — expand its cut plan/i);
  });

  it("returns null for unknown cut count, published files, and fiction episodes", () => {
    expect(previewFooterGuidance({ ...base, fileName: "plot-01.md", contentType: "cartoon", cutCount: null })).toBeNull();
    expect(previewFooterGuidance({ ...base, fileName: "genesis.md", contentType: "cartoon", cutCount: 0, isPublished: true })).toBeNull();
    expect(previewFooterGuidance({ ...base, fileName: "plot-01.md", contentType: "fiction", cutCount: 0 })).toBeNull();
  });
});
