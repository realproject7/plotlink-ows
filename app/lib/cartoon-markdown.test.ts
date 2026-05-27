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

  it("generates narration text for blank narration cut", () => {
    const cut = makeCut({
      cleanImagePath: null, finalImagePath: null,
      narration: "Time passed.", dialogue: [{ speaker: "Mira", text: "Hello." }],
    });
    const block = generateCutBlock(cut, 3);
    expect(block).toContain("**Mira:** Hello.");
    expect(block).toContain("*Time passed.*");
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

  it("preserves prose between blocks", () => {
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
    expect(markdown).toContain("Some intro prose.");
    expect(markdown).toContain("Manual commentary here.");
    expect(markdown).toContain("https://new.com");
  });

  it("adds new cut blocks for new cuts", () => {
    const existing = "# Episode\n\nIntro text.";
    const cuts = [makeCut({ uploadedUrl: "https://new.com" })];
    const { markdown } = mergeCartoonMarkdown(existing, cuts);
    expect(markdown).toContain("Intro text.");
    expect(markdown).toContain("cut-001");
    expect(markdown).toContain("https://new.com");
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
