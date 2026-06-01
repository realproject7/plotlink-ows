import { describe, it, expect } from "vitest";
import { toPixel, toNorm, createOverlay, speechTailPoints } from "./overlays";

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
  it("creates speech overlay with defaults and tailAnchor", () => {
    const o = createOverlay("speech", 0.2, 0.3);
    expect(o.type).toBe("speech");
    expect(o.x).toBe(0.2);
    expect(o.y).toBe(0.3);
    expect(o.width).toBe(0.25);
    expect(o.height).toBe(0.12);
    expect(o.text).toBe("");
    expect(o.speaker).toBe("");
    expect(o.tailAnchor).toEqual({ x: 0.5, y: 1.2 });
    expect(o.id).toMatch(/^overlay-/);
  });

  it("tailAnchor survives JSON roundtrip", () => {
    const o = createOverlay("speech");
    const json = JSON.parse(JSON.stringify(o));
    expect(json.tailAnchor).toEqual({ x: 0.5, y: 1.2 });
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

describe("speechTailPoints", () => {
  // Bubble rect: ox=100, oy=100, ow=200, oh=100 → center (200, 150).
  const ox = 100, oy = 100, ow = 200, oh = 100;

  it("points the tail tip below the bubble for the default {0.5, 1.2} anchor", () => {
    const pts = speechTailPoints(ox, oy, ow, oh, { x: 0.5, y: 1.2 });
    expect(pts).not.toBeNull();
    // tip = (ox + 0.5*ow, oy + 1.2*oh) = (200, 220), below the bubble bottom (200).
    expect(pts!.tip).toEqual({ x: 200, y: 220 });
    // base sits on the bottom edge (oy + oh = 200), centered under the tip x.
    expect(pts!.base1.y).toBe(200);
    expect(pts!.base2.y).toBe(200);
    expect((pts!.base1.x + pts!.base2.x) / 2).toBeCloseTo(200, 5);
    expect(pts!.base2.x).toBeGreaterThan(pts!.base1.x);
  });

  it("anchors the base to the top edge when the tail points up", () => {
    const pts = speechTailPoints(ox, oy, ow, oh, { x: 0.5, y: -0.5 });
    expect(pts).not.toBeNull();
    expect(pts!.tip).toEqual({ x: 200, y: 50 });
    expect(pts!.base1.y).toBe(100); // top edge
    expect(pts!.base2.y).toBe(100);
  });

  it("anchors the base to the side edge when the tail points sideways", () => {
    const pts = speechTailPoints(ox, oy, ow, oh, { x: 1.3, y: 0.5 });
    expect(pts).not.toBeNull();
    // tip = (100 + 1.3*200, 150) = (360, 150), to the right of the bubble (300).
    expect(pts!.tip).toEqual({ x: 360, y: 150 });
    // base is vertical on the right edge (ox + ow = 300).
    expect(pts!.base1.x).toBe(300);
    expect(pts!.base2.x).toBe(300);
    expect(pts!.base2.y).toBeGreaterThan(pts!.base1.y);
  });

  it("returns null when the tip falls inside the bubble (no visible tail)", () => {
    expect(speechTailPoints(ox, oy, ow, oh, { x: 0.5, y: 0.5 })).toBeNull();
    expect(speechTailPoints(ox, oy, ow, oh, { x: 0.9, y: 0.9 })).toBeNull();
  });
});
