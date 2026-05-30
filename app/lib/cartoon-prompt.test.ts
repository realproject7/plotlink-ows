import { describe, it, expect } from "vitest";
import { buildCleanImagePrompt } from "./cartoon-prompt";
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
