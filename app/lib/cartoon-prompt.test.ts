import { describe, it, expect } from "vitest";
import { buildCleanImagePrompt, buildCodexTaskPrompt, cleanImageOutputPath } from "./cartoon-prompt";
import type { Cut } from "./cuts";

function makeCut(overrides: Partial<Cut> = {}): Cut {
  return {
    id: 1,
    shotType: "medium",
    description: "Test scene",
    characters: [],
    dialogue: [],
    narration: "",
    sfx: "",
    cleanImagePath: null,
    finalImagePath: null,
    exportedAt: null,
    uploadedCid: null,
    uploadedUrl: null,
    overlays: [],
    ...overrides,
  };
}

const NO_TEXT_CONSTRAINT =
  "No speech bubbles, captions, sound effects, narration, or any text or lettering in the image.";

describe("buildCleanImagePrompt", () => {
  it("leads with a readable shot type and the description", () => {
    const prompt = buildCleanImagePrompt(
      makeCut({ shotType: "wide", description: "Rain-soaked city at dusk" }),
    );
    expect(prompt).toContain("Wide shot. Rain-soaked city at dusk");
  });

  it("maps all known shot types to readable labels", () => {
    expect(buildCleanImagePrompt(makeCut({ shotType: "close-up" }))).toContain("Close-up shot.");
    expect(buildCleanImagePrompt(makeCut({ shotType: "extreme-close-up" }))).toContain(
      "Extreme close-up shot.",
    );
  });

  it("falls back to the cut id when there is no description", () => {
    const prompt = buildCleanImagePrompt(makeCut({ id: 7, description: "" }));
    expect(prompt).toContain("Cut 7");
  });

  it("includes characters when present", () => {
    const prompt = buildCleanImagePrompt(makeCut({ characters: ["Mira", "Jon"] }));
    expect(prompt).toContain("Characters: Mira, Jon.");
  });

  it("omits the characters line when there are no characters", () => {
    const prompt = buildCleanImagePrompt(makeCut({ characters: [] }));
    expect(prompt).not.toContain("Characters:");
  });

  it("always appends the no-text constraint line", () => {
    const prompt = buildCleanImagePrompt(makeCut());
    expect(prompt).toContain(NO_TEXT_CONSTRAINT);
  });

  it("adds a webtoon style lock and anti-photoreal guardrail", () => {
    const prompt = buildCleanImagePrompt(makeCut());
    expect(prompt).toContain("illustrated Korean vertical webtoon panel");
    expect(prompt).toContain("clean black contour lines");
    expect(prompt).toContain("Avoid photorealistic photo");
    expect(prompt).toContain("hyperreal skin texture");
  });

  it("does NOT include dialogue, narration, or sfx text in the prompt", () => {
    const prompt = buildCleanImagePrompt(
      makeCut({
        description: "A quiet room",
        dialogue: [{ speaker: "Mira", text: "Secret dialogue line" }],
        narration: "Secret narration text",
        sfx: "SECRETSFX",
      }),
    );
    expect(prompt).not.toContain("Secret dialogue line");
    expect(prompt).not.toContain("Secret narration text");
    expect(prompt).not.toContain("SECRETSFX");
  });

  it("is a pure function (does not mutate the cut)", () => {
    const cut = makeCut({ characters: ["Mira"] });
    const before = JSON.stringify(cut);
    buildCleanImagePrompt(cut);
    expect(JSON.stringify(cut)).toBe(before);
  });
});

describe("cleanImageOutputPath", () => {
  it("builds the canonical zero-padded webp path", () => {
    expect(cleanImageOutputPath("plot-01", 1)).toBe("assets/plot-01/cut-01-clean.webp");
    expect(cleanImageOutputPath("plot-02", 10)).toBe("assets/plot-02/cut-10-clean.webp");
  });
});

describe("buildCodexTaskPrompt", () => {
  it("includes the exact target output path (multiple times)", () => {
    const prompt = buildCodexTaskPrompt(makeCut({ id: 3 }), "plot-01");
    expect(prompt).toContain("assets/plot-01/cut-03-clean.webp");
  });

  it("tells the agent to create real image output, not describe it", () => {
    const prompt = buildCodexTaskPrompt(makeCut(), "plot-01");
    expect(prompt).toContain("Create real image output");
    expect(prompt).toContain("do not just describe it or return a prompt");
  });

  it("accepts Codex PNG cache output and directs the writer to import it", () => {
    const prompt = buildCodexTaskPrompt(makeCut(), "plot-01");
    expect(prompt).toContain("~/.codex/generated_images");
    expect(prompt).toContain("that is acceptable");
    expect(prompt).toContain("Import from Codex");
    expect(prompt).toContain("continue generating the remaining requested cuts");
  });

  it("still names the direct-save path but does not require terminal-side conversion", () => {
    const prompt = buildCodexTaskPrompt(makeCut(), "plot-01");
    expect(prompt).toContain("WebP");
    expect(prompt).toContain("save it at assets/plot-01/cut-01-clean.webp");
    expect(prompt).toContain("Do not convert it in the terminal");
  });

  it("keeps the clean-image-only / no-text constraints", () => {
    const prompt = buildCodexTaskPrompt(makeCut(), "plot-01");
    expect(prompt).toContain("Clean image only");
    expect(prompt).toContain("no text, speech bubbles");
  });

  it("reminds that lettering/upload happen later", () => {
    const prompt = buildCodexTaskPrompt(makeCut(), "plot-01");
    expect(prompt).toContain("final lettering and upload happen later");
  });

  it("keeps the anti-photoreal webtoon style lock in the task prompt", () => {
    const prompt = buildCodexTaskPrompt(makeCut(), "plot-01");
    expect(prompt).toContain("Keep the webtoon style lock");
    expect(prompt).toContain("avoid photorealistic");
  });

  it("embeds the pure visual prompt (no scene detail lost)", () => {
    const cut = makeCut({ shotType: "wide", description: "Rain-soaked city", characters: ["Mira"] });
    const prompt = buildCodexTaskPrompt(cut, "plot-01");
    expect(prompt).toContain(buildCleanImagePrompt(cut));
  });

  it("still excludes dialogue/narration/sfx text", () => {
    const prompt = buildCodexTaskPrompt(
      makeCut({
        dialogue: [{ speaker: "Mira", text: "Secret dialogue line" }],
        narration: "Secret narration text",
        sfx: "SECRETSFX",
      }),
      "plot-01",
    );
    expect(prompt).not.toContain("Secret dialogue line");
    expect(prompt).not.toContain("Secret narration text");
    expect(prompt).not.toContain("SECRETSFX");
  });

  it("is a pure function (does not mutate the cut)", () => {
    const cut = makeCut({ characters: ["Mira"] });
    const before = JSON.stringify(cut);
    buildCodexTaskPrompt(cut, "plot-01");
    expect(JSON.stringify(cut)).toBe(before);
  });
});
