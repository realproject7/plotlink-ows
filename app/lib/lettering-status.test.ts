import { describe, it, expect } from "vitest";
import { cutLetteringChecklist, cutScriptLines } from "./lettering-status";

describe("cutLetteringChecklist (#336)", () => {
  it("reports nothing done for an empty cut", () => {
    const c = cutLetteringChecklist({});
    expect(c).toEqual({
      hasCleanImage: false,
      hasScriptText: false,
      bubblesPlaced: 0,
      exported: false,
      uploaded: false,
    });
  });

  it("derives each step from the cut record", () => {
    const c = cutLetteringChecklist({
      cleanImagePath: "c.webp",
      dialogue: [{ speaker: "Mira", text: "Hi" }],
      overlays: [{ id: "o1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "Hi" }],
      finalImagePath: "f.webp",
      exportedAt: "2026-01-01",
      uploadedUrl: "https://ipfs/Qm",
    });
    expect(c).toEqual({
      hasCleanImage: true,
      hasScriptText: true,
      bubblesPlaced: 1,
      exported: true,
      uploaded: true,
    });
  });

  it("treats narration or SFX as script text, and exportedAt or finalImagePath as exported", () => {
    expect(cutLetteringChecklist({ narration: "Later..." }).hasScriptText).toBe(true);
    expect(cutLetteringChecklist({ sfx: "BOOM" }).hasScriptText).toBe(true);
    expect(cutLetteringChecklist({ exportedAt: "2026-01-01" }).exported).toBe(true);
    expect(cutLetteringChecklist({ finalImagePath: "f.webp" }).exported).toBe(true);
    expect(cutLetteringChecklist({ uploadedCid: "Qm" }).uploaded).toBe(true);
  });

  it("ignores whitespace-only narration/SFX", () => {
    expect(cutLetteringChecklist({ narration: "   ", sfx: "  " }).hasScriptText).toBe(false);
  });
});

describe("cutScriptLines (#336)", () => {
  it("flattens dialogue, narration and SFX into insertable lines in order", () => {
    const lines = cutScriptLines({
      dialogue: [{ speaker: "Mira", text: "We're here." }, { speaker: "Jin", text: "Finally." }],
      narration: "Dawn broke.",
      sfx: "BANG",
    });
    expect(lines.map((l) => l.type)).toEqual(["speech", "speech", "narration", "sfx"]);
    expect(lines[0]).toEqual({ type: "speech", speaker: "Mira", text: "We're here.", key: "speech-0" });
    expect(lines[2]).toEqual({ type: "narration", text: "Dawn broke.", key: "narration" });
    expect(lines[3]).toEqual({ type: "sfx", text: "BANG", key: "sfx" });
  });

  it("skips empty pieces (no blank script lines)", () => {
    const lines = cutScriptLines({
      dialogue: [{ speaker: "A", text: "" }, { speaker: "B", text: "hi" }],
      narration: "   ",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("hi");
  });

  it("returns an empty list for a cut with no script", () => {
    expect(cutScriptLines({})).toEqual([]);
  });
});
