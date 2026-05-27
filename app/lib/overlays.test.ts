import { describe, it, expect } from "vitest";
import { toPixel, toNorm, createOverlay } from "./overlays";

describe("toPixel", () => {
  it("converts 0.5 to half of container", () => {
    expect(toPixel(0.5, 800)).toBe(400);
  });

  it("converts 0 to 0", () => {
    expect(toPixel(0, 600)).toBe(0);
  });

  it("converts 1 to full container", () => {
    expect(toPixel(1, 600)).toBe(600);
  });

  it("handles fractional values", () => {
    expect(toPixel(0.25, 1000)).toBe(250);
  });
});

describe("toNorm", () => {
  it("converts half to 0.5", () => {
    expect(toNorm(400, 800)).toBe(0.5);
  });

  it("converts 0 to 0", () => {
    expect(toNorm(0, 800)).toBe(0);
  });

  it("returns 0 for zero container size", () => {
    expect(toNorm(100, 0)).toBe(0);
  });
});

describe("createOverlay", () => {
  it("creates speech overlay with defaults", () => {
    const o = createOverlay("speech", 0.2, 0.3);
    expect(o.type).toBe("speech");
    expect(o.x).toBe(0.2);
    expect(o.y).toBe(0.3);
    expect(o.width).toBe(0.25);
    expect(o.height).toBe(0.12);
    expect(o.text).toBe("");
    expect(o.speaker).toBe("");
    expect(o.id).toMatch(/^overlay-/);
  });

  it("creates sfx overlay with smaller dimensions", () => {
    const o = createOverlay("sfx");
    expect(o.type).toBe("sfx");
    expect(o.width).toBe(0.15);
    expect(o.height).toBe(0.08);
    expect(o.speaker).toBeUndefined();
  });

  it("creates narration overlay without speaker", () => {
    const o = createOverlay("narration");
    expect(o.type).toBe("narration");
    expect(o.speaker).toBeUndefined();
  });

  it("generates unique IDs", () => {
    const a = createOverlay("speech");
    const b = createOverlay("speech");
    expect(a.id).not.toBe(b.id);
  });
});
