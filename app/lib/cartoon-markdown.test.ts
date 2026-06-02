import { describe, it, expect } from "vitest";
import { generateCutBlock, generateCartoonMarkdown, mergeCartoonMarkdown, getReadinessWarnings } from "./cartoon-markdown";
import type { Cut } from "./cuts";

function makeCut(overrides: Partial<Cut> = {}): Cut {
  return {
    id: 1, shotType: "medium", description: "A scene", characters: [],
    dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null,
    exportedAt: null, uploadedCid: null, uploadedUrl: null,
    overlays: [],
    ...overrides,
  };
}

describe("generateCutBlock", () => {
  it("generates block with uploaded URL", () => {
    const cut = makeCut({ description: "City view", uploadedUrl: "https://ipfs.example.com/Qm123" });
    const block = generateCutBlock(cut, 1);
    expect(block).toContain("<!-- ows:cartoon-cut cut-001 start -->");
    expect(block).toContain("![City view](https://ipfs.example.com/Qm123)");
    expect(block).toContain("<!-- ows:cartoon-cut cut-001 end -->");
  });

  it("generates comment placeholder when not uploaded", () => {
    const cut = makeCut({ cleanImagePath: "assets/plot-01/cut-01-clean.webp" });
    const block = generateCutBlock(cut, 2);
    expect(block).toContain("cut-002");
    expect(block).toContain("<!-- Cut 2: awaiting upload -->");
    expect(block).not.toContain("![");
  });

  it("missing upload produces no image markdown", () => {
    const cut = makeCut({ cleanImagePath: "assets/plot-01/cut-01-clean.webp", finalImagePath: "assets/plot-01/cut-01-final.webp" });
    const block = generateCutBlock(cut, 1);
    expect(block).not.toMatch(/!\[/);
    expect(block).toContain("awaiting upload");
  });

  it("never emits local asset paths for unuploaded cut", () => {
    const cut = makeCut({ cleanImagePath: "assets/plot-01/cut-01-clean.webp", finalImagePath: "assets/plot-01/cut-01-final.webp" });
    const block = generateCutBlock(cut, 1);
    expect(block).not.toContain("assets/");
    expect(block).not.toMatch(/\.webp|\.jpg|\.jpeg/);
  });

  it("emits awaiting-upload comment for a planned cut, never dialogue/narration prose", () => {
    const cut = makeCut({
      cleanImagePath: null, finalImagePath: null,
      narration: "Time passed.", dialogue: [{ speaker: "Mira", text: "Hello." }],
    });
    const block = generateCutBlock(cut, 3);
    expect(block).toContain("cut-003");
    expect(block).toContain("<!-- Cut 3: awaiting upload -->");
    // Publish-facing markdown must not become a text script before images exist.
    expect(block).not.toContain("**Mira:** Hello.");
    expect(block).not.toContain("Time passed.");
    expect(block).not.toContain("![");
  });

  it("emits awaiting-upload comment for an empty planned cut (no text, no image)", () => {
    const cut = makeCut({ cleanImagePath: null, finalImagePath: null });
    const block = generateCutBlock(cut, 4);
    expect(block).toContain("<!-- Cut 4: awaiting upload -->");
    expect(block).not.toContain("Narration");
    expect(block).not.toContain("![");
  });
});

describe("generateCartoonMarkdown", () => {
  it("generates all blocks in order", () => {
    const cuts = [
      makeCut({ id: 1, description: "First", uploadedUrl: "https://example.com/1" }),
      makeCut({ id: 2, description: "Second", uploadedUrl: "https://example.com/2" }),
    ];
    const md = generateCartoonMarkdown(cuts);
    expect(md).toContain("cut-001");
    expect(md).toContain("cut-002");
    expect(md.indexOf("cut-001")).toBeLessThan(md.indexOf("cut-002"));
  });
});

describe("mergeCartoonMarkdown", () => {
  it("replaces existing blocks", () => {
    const existing = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![Old](https://old.com)",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");

    const cuts = [makeCut({ description: "New", uploadedUrl: "https://new.com" })];
    const { markdown } = mergeCartoonMarkdown(existing, cuts);
    expect(markdown).toContain("https://new.com");
    expect(markdown).not.toContain("https://old.com");
  });

  it("discards non-marker prose so publish markdown is image-only (#319)", async () => {
    const existing = [
      "# Episode 1",
      "",
      "Some intro prose.",
      "",
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![Old](https://old.com)",
      "<!-- ows:cartoon-cut cut-001 end -->",
      "",
      "Manual commentary here.",
    ].join("\n");

    const cuts = [makeCut({ uploadedUrl: "https://new.com" })];
    const { markdown } = mergeCartoonMarkdown(existing, cuts);
    // Non-marker prose/headings are dropped — only the (regenerated) cut block remains.
    expect(markdown).not.toContain("Some intro prose.");
    expect(markdown).not.toContain("Manual commentary here.");
    expect(markdown).not.toContain("# Episode 1");
    expect(markdown).toContain("https://new.com");
    // The generated markdown is publish-ready with no leftover prose.
    const { checkMarkdownReadiness } = await import("./cartoon-readiness");
    expect(checkMarkdownReadiness(markdown, cuts).ready).toBe(true);
  });

  it("adds cut blocks and drops the scaffold prose for new cuts", () => {
    const existing = "# Episode\n\nIntro text.";
    const cuts = [makeCut({ uploadedUrl: "https://new.com" })];
    const { markdown } = mergeCartoonMarkdown(existing, cuts);
    expect(markdown).not.toContain("Intro text.");
    expect(markdown).toContain("cut-001");
    expect(markdown).toContain("https://new.com");
  });

  it("discards prose directly adjacent to a marker block with no blank-line separator (#319, re1)", async () => {
    // Prose on the same blank-line paragraph as a cut block used to leak: a
    // block-only regex replace swapped the marker block but left the
    // surrounding `Intro`/`Outro` text. Rebuilding from cuts removes it.
    const existing = [
      "Intro scaffold text",
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![Old](https://old.com)",
      "<!-- ows:cartoon-cut cut-001 end -->",
      "Outro scaffold text",
    ].join("\n");
    const cuts = [makeCut({ uploadedUrl: "https://new.com" })];
    const { markdown } = mergeCartoonMarkdown(existing, cuts);
    expect(markdown).not.toContain("Intro scaffold text");
    expect(markdown).not.toContain("Outro scaffold text");
    expect(markdown).not.toContain("https://old.com");
    expect(markdown).toContain("https://new.com");
    const { checkMarkdownReadiness } = await import("./cartoon-readiness");
    expect(checkMarkdownReadiness(markdown, cuts).ready).toBe(true);
  });

  it("discards arbitrary instructional prose that no placeholder pattern matches (#319)", async () => {
    // The #211 pilot leaked instructional scaffold that fell outside the known
    // placeholder allowlist, so it survived into publish markdown and forced a
    // manual rewrite. A pure image sequence must drop it regardless of wording.
    const existing = [
      "Drop your finished panels here once the artist signs off, then click the button.",
      "",
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![Old](https://old.com)",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");
    const cuts = [makeCut({ uploadedUrl: "https://new.com" })];
    const { markdown } = mergeCartoonMarkdown(existing, cuts);
    expect(markdown).not.toContain("Drop your finished panels");
    expect(markdown).toContain("https://new.com");
    const { checkMarkdownReadiness } = await import("./cartoon-readiness");
    expect(checkMarkdownReadiness(markdown, cuts).ready).toBe(true);
  });

  it("removes stale blocks and warns", () => {
    const existing = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![Old](https://old.com)",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");

    const { markdown, warnings } = mergeCartoonMarkdown(existing, []);
    expect(markdown).not.toContain("cut-001");
    expect(warnings).toContain("Removed stale block: cut-001");
  });

  it("handles reordered cuts", () => {
    const existing = [
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![A](https://a.com)",
      "<!-- ows:cartoon-cut cut-001 end -->",
      "",
      "<!-- ows:cartoon-cut cut-002 start -->",
      "![B](https://b.com)",
      "<!-- ows:cartoon-cut cut-002 end -->",
    ].join("\n");

    const cuts = [
      makeCut({ description: "B-updated", uploadedUrl: "https://b2.com" }),
      makeCut({ description: "A-updated", uploadedUrl: "https://a2.com" }),
    ];
    const { markdown } = mergeCartoonMarkdown(existing, cuts);
    expect(markdown).toContain("https://b2.com");
    expect(markdown).toContain("cut-002");
  });

  it("warns on missing upload URLs", () => {
    const cuts = [makeCut({ cleanImagePath: "assets/plot-01/cut-01-clean.webp" })];
    const { warnings } = mergeCartoonMarkdown("", cuts);
    expect(warnings).toContain("Cut 1: missing upload URL");
  });

  it("warns for a planned text cut with no image yet (treated as image pending)", () => {
    const cuts = [makeCut({ cleanImagePath: null, finalImagePath: null, narration: "A quiet street." })];
    const { markdown, warnings } = mergeCartoonMarkdown("", cuts);
    expect(warnings).toContain("Cut 1: missing upload URL");
    expect(markdown).toContain("<!-- Cut 1: awaiting upload -->");
    expect(markdown).not.toContain("A quiet street.");
  });

  it("strips pre-generation placeholder prose so Generate MD output is image-only (#286)", async () => {
    const existing = [
      "Placeholder only. OWS should generate the publish markdown from `plot-01.cuts.json` after clean images are approved, lettered final images are created, and final images are uploaded.",
      "",
      "<!-- ows:cartoon-cut cut-001 start -->",
      "![Old](https://old.com)",
      "<!-- ows:cartoon-cut cut-001 end -->",
    ].join("\n");

    const cuts = [makeCut({ uploadedUrl: "https://new.com" })];
    const { markdown } = mergeCartoonMarkdown(existing, cuts);
    expect(markdown).not.toContain("Placeholder only");
    expect(markdown).not.toContain("OWS should generate");
    expect(markdown).toContain("https://new.com");
    // The result must now pass the readiness gate (no leftover placeholder prose).
    const { checkMarkdownReadiness } = await import("./cartoon-readiness");
    expect(checkMarkdownReadiness(markdown, cuts).ready).toBe(true);
  });

  it("fiction markdown is unaffected (no markers)", () => {
    const fiction = "# Chapter 1\n\nOnce upon a time...";
    const { markdown } = mergeCartoonMarkdown(fiction, []);
    expect(markdown).toBe(fiction);
  });
});

describe("getReadinessWarnings", () => {
  it("warns for each cut without uploadedUrl", () => {
    const cuts = [
      makeCut({ uploadedUrl: "https://ok.com" }),
      makeCut({ uploadedUrl: null }),
      makeCut({ uploadedUrl: null }),
    ];
    const warnings = getReadinessWarnings(cuts);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("Cut 2");
    expect(warnings[1]).toContain("Cut 3");
  });

  it("returns empty for all uploaded cuts", () => {
    const cuts = [makeCut({ uploadedUrl: "https://ok.com" })];
    expect(getReadinessWarnings(cuts)).toHaveLength(0);
  });
});

describe("generated markdown + readiness integration", () => {
  it("unuploaded cuts generate markdown that fails readiness (cannot look publish-ready)", async () => {
    const { checkMarkdownReadiness } = await import("./cartoon-readiness");
    const cuts = [makeCut({ cleanImagePath: "assets/plot-01/cut-01-clean.webp", finalImagePath: "assets/plot-01/cut-01-final.webp" })];
    const md = generateCartoonMarkdown(cuts);

    expect(md).not.toContain("assets/");
    expect(md).not.toMatch(/!\[/);

    const { ready, issues } = checkMarkdownReadiness(md, cuts);
    expect(ready).toBe(false);
    expect(issues.some((i) => i.includes("awaiting-upload"))).toBe(true);
  });

  it("uploaded cuts generate markdown that passes readiness", async () => {
    const { checkMarkdownReadiness } = await import("./cartoon-readiness");
    const cuts = [makeCut({
      description: "Scene",
      cleanImagePath: "assets/plot-01/cut-01-clean.webp",
      finalImagePath: "assets/plot-01/cut-01-final.webp",
      uploadedUrl: "https://ipfs.example.com/QmAbc",
    })];
    const md = generateCartoonMarkdown(cuts);

    expect(md).toContain("https://ipfs.example.com/QmAbc");
    expect(md).toContain("<!-- ows:cartoon-cut cut-001 start -->");

    const { ready } = checkMarkdownReadiness(md, cuts);
    expect(ready).toBe(true);
  });
});
