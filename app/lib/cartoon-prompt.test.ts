import { describe, it, expect } from "vitest";
import {
  buildCleanImagePrompt,
  buildCodexTaskPrompt,
  buildLetteringPrompt,
  cleanImageOutputPath,
  CLEAN_IMAGE_STYLE_LOCK,
} from "./cartoon-prompt";
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

  it("locks the illustrated style with hard anti-photoreal negatives (#404)", () => {
    const prompt = buildCleanImagePrompt(makeCut());
    // The whole style-lock block is embedded verbatim...
    expect(prompt).toContain(CLEAN_IMAGE_STYLE_LOCK);
    // ...and it carries both the positive look and the hard negatives that fight drift.
    expect(prompt).toContain("illustrated comic/webtoon panel");
    expect(prompt).toContain("NOT photorealistic");
    expect(prompt).toContain("NOT a 3D/CGI render");
    expect(prompt).toContain("NOT concept art");
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

  it("tells the agent to produce the actual image, not just a prompt", () => {
    const prompt = buildCodexTaskPrompt(makeCut(), "plot-01");
    expect(prompt).toContain("Produce the actual image");
    expect(prompt).toContain("do not just describe it or return a prompt");
  });

  it("accepts a generated PNG and routes it to the Import from Codex picker (#403)", () => {
    const prompt = buildCodexTaskPrompt(makeCut(), "plot-01");
    // A PNG in the cache is an accepted outcome — the agent must NOT convert it.
    expect(prompt).toContain("only produces a PNG");
    expect(prompt).toContain("~/.codex/generated_images");
    expect(prompt).toContain("do NOT convert or rename it yourself");
    expect(prompt).toContain("Import from Codex");
  });

  it("states the format and size limit for the direct-save path", () => {
    const prompt = buildCodexTaskPrompt(makeCut(), "plot-01");
    expect(prompt).toContain("WebP");
    expect(prompt).toContain("under 1MB");
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

  it("embeds the pure visual prompt (no scene detail lost)", () => {
    const cut = makeCut({ shotType: "wide", description: "Rain-soaked city", characters: ["Mira"] });
    const prompt = buildCodexTaskPrompt(cut, "plot-01");
    expect(prompt).toContain(buildCleanImagePrompt(cut));
  });

  it("carries the style lock and a regenerate-if-photoreal instruction (#404)", () => {
    const prompt = buildCodexTaskPrompt(makeCut(), "plot-01");
    // Inherited via the embedded visual prompt...
    expect(prompt).toContain(CLEAN_IMAGE_STYLE_LOCK);
    expect(prompt).toContain("NOT photorealistic");
    // ...plus an explicit task-level reminder to regenerate off-style results.
    expect(prompt).toContain("Hold the style lock above");
    expect(prompt).toContain("regenerate it as illustrated panel art");
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

describe("buildLetteringPrompt (#442)", () => {
  it("lists the cut's script and instructs editing the overlays array, without exporting", () => {
    const cut = makeCut({
      id: 3,
      dialogue: [{ speaker: "세라", text: "그거 방금 네가 움직인 걸 따라한 거야." }],
      narration: "화면의 점들은 사라지지 않았다.",
    });
    const prompt = buildLetteringPrompt(cut, "genesis");
    // Names the cut + the cuts.json file to edit.
    expect(prompt).toContain("cut 3 of genesis");
    expect(prompt).toContain("genesis.cuts.json");
    // Carries the real script lines (speaker + narration), typed by overlay kind.
    expect(prompt).toContain('speech — 세라: "그거 방금 네가 움직인 걸 따라한 거야."');
    expect(prompt).toContain("narration: 화면의 점들은 사라지지 않았다.");
    expect(prompt).toContain("Supported overlay kinds");
    expect(prompt).toContain('"thought"');
    expect(prompt).toContain('"whisper"');
    expect(prompt).toContain('"dread"');
    expect(prompt).toContain('"caption"');
    expect(prompt).toContain("Assign tone/purpose");
    // Draft-only: the human reviews + exports, the agent must not.
    expect(prompt).toMatch(/do NOT export or upload/i);
    expect(prompt).toMatch(/review/i);
  });

  it("handles a cut with no script text gracefully", () => {
    const prompt = buildLetteringPrompt(makeCut({ id: 1 }), "plot-01");
    expect(prompt).toContain("no dialogue/narration/SFX recorded");
  });

  it("is pure (does not mutate the cut)", () => {
    const cut = makeCut({ id: 2, narration: "x" });
    const before = JSON.stringify(cut);
    buildLetteringPrompt(cut, "plot-01");
    expect(JSON.stringify(cut)).toBe(before);
  });
});
