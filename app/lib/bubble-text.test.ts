import { describe, it, expect } from "vitest";
import { wrapText, layoutBubbleText, defaultBubbleFontRange } from "./bubble-text";

// Deterministic measurer: width is proportional to char count × font size, so
// wrapping/fit behavior is predictable without a real canvas (#310).
const measure = (text: string, fontSize: number) => text.length * fontSize * 0.5;

describe("wrapText (#310)", () => {
  it("wraps a long line into multiple word-lines that fit the width", () => {
    const lines = wrapText(measure, "the quick brown fox jumps over the lazy dog", 60, 10);
    expect(lines.length).toBeGreaterThan(1);
    // No line wider than maxWidth (each line ≤ 60 at fontSize 10 → ≤12 chars).
    for (const l of lines) expect(measure(l, 10)).toBeLessThanOrEqual(60);
    // No words lost.
    expect(lines.join(" ")).toBe("the quick brown fox jumps over the lazy dog");
  });

  it("keeps an over-long single word on its own line (font shrinks elsewhere)", () => {
    const lines = wrapText(measure, "supercalifragilistic", 40, 10);
    expect(lines).toEqual(["supercalifragilistic"]);
  });

  it("returns [\"\"] for empty text", () => {
    expect(wrapText(measure, "   ", 100, 10)).toEqual([""]);
  });
});

describe("layoutBubbleText (#310)", () => {
  it("wraps long dialogue into multiple lines instead of one compressed line", () => {
    const layout = layoutBubbleText(measure, "the quick brown fox jumps over the lazy dog again", 200, 90, {
      minFontSize: 10,
      maxFontSize: 30,
    });
    expect(layout.lines.length).toBeGreaterThan(1);
    // Fits the box height.
    expect(layout.lines.length * layout.lineHeight).toBeLessThanOrEqual(90);
    // Each line fits the box width.
    for (const l of layout.lines) expect(measure(l, layout.fontSize)).toBeLessThanOrEqual(200);
  });

  it("uses the max font for short text and a single line", () => {
    const layout = layoutBubbleText(measure, "Hi", 200, 90, { minFontSize: 10, maxFontSize: 28 });
    expect(layout.lines).toEqual(["Hi"]);
    expect(layout.fontSize).toBe(28);
  });

  it("never drops below the min font even when text cannot fit", () => {
    const layout = layoutBubbleText(measure, "x".repeat(80), 40, 18, { minFontSize: 11, maxFontSize: 30 });
    expect(layout.fontSize).toBe(11);
    expect(layout.lines.length).toBeGreaterThanOrEqual(1); // best-effort, not crash
  });

  it("reserves a speaker strip and sizes the label relative to the body", () => {
    const withSpeaker = layoutBubbleText(measure, "Hello there friend", 200, 90, {
      minFontSize: 10,
      maxFontSize: 30,
      hasSpeaker: true,
    });
    const noSpeaker = layoutBubbleText(measure, "Hello there friend", 200, 90, {
      minFontSize: 10,
      maxFontSize: 30,
      hasSpeaker: false,
    });
    expect(withSpeaker.speakerFontSize).toBeCloseTo(withSpeaker.fontSize * 0.8);
    expect(noSpeaker.speakerFontSize).toBe(0);
    // Reserving the strip leaves no more vertical room, so body font ≤ no-speaker.
    expect(withSpeaker.fontSize).toBeLessThanOrEqual(noSpeaker.fontSize);
  });
});

describe("defaultBubbleFontRange (#310)", () => {
  it("scales min/max with render height so preview and export wrap alike", () => {
    const big = defaultBubbleFontRange(600);
    const small = defaultBubbleFontRange(300);
    // Same ratio at half scale → identical wrapping decisions.
    expect(small.maxFontSize).toBeCloseTo(big.maxFontSize / 2);
    expect(small.minFontSize).toBeCloseTo(big.minFontSize / 2);
    expect(big.maxFontSize).toBeGreaterThan(big.minFontSize);
  });
});
