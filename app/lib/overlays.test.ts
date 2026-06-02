import { describe, it, expect } from "vitest";
import {
  toPixel,
  toNorm,
  createOverlay,
  speechTailPoints,
  balloonPathD,
  balloonOutline,
  defaultBalloonRadius,
  normalizeOverlay,
  normalizeOverlays,
  anchorFromPosition,
  validateOverlaysForExport,
  detectOverlappingOverlays,
  isOverlayOutOfBounds,
  OVERLAP_AREA_THRESHOLD,
  hasVisibleSpeechTail,
  CARTOON_BUBBLE_RENDERER_VERSION,
} from "./overlays";

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

  // #361: a tail aimed near a corner must keep BOTH base points on the straight
  // part of the edge (clear of the rounded corners). Otherwise the unified
  // body+tail outline back-tracks into a corner arc and renders as a visible
  // internal notch/seam between the body and the tail.
  describe("tail mouth stays clear of rounded corners (#361)", () => {
    const r = defaultBalloonRadius(ow, oh); // the shared default balloon radius
    const eps = 1e-9;

    it("keeps the default centered tail unchanged (no regression)", () => {
      // ow=200 → baseW = max(6, min(200,100)*0.3) = 30, centered under tip x=200.
      const pts = speechTailPoints(ox, oy, ow, oh, { x: 0.5, y: 1.2 })!;
      expect(pts.base1.x).toBe(185);
      expect(pts.base2.x).toBe(215);
    });

    it("never places a base point inside the corner radius, for any near-corner anchor", () => {
      const coords = [-0.5, 0.02, 0.5, 0.98, 1.5];
      for (const ax of coords) {
        for (const ay of coords) {
          const pts = speechTailPoints(ox, oy, ow, oh, { x: ax, y: ay });
          if (!pts) continue; // tip inside the bubble → no tail
          const onHorizontalEdge = pts.base1.y === pts.base2.y;
          if (onHorizontalEdge) {
            // base spans the x axis → must sit within [ox+r, ox+ow-r].
            expect(pts.base1.x).toBeGreaterThanOrEqual(ox + r - eps);
            expect(pts.base2.x).toBeLessThanOrEqual(ox + ow - r + eps);
          } else {
            // base spans the y axis → must sit within [oy+r, oy+oh-r].
            expect(pts.base1.y).toBeGreaterThanOrEqual(oy + r - eps);
            expect(pts.base2.y).toBeLessThanOrEqual(oy + oh - r + eps);
          }
        }
      }
    });

    it("a corner-aimed tail outline does not back-track into a corner arc", () => {
      // Tail aimed down-and-right (toward the bottom-right corner). Pre-fix this
      // pushed a base point onto the corner, so the bottom edge run reversed
      // (…→corner→up→arc), leaving a seam. Assert the edge run is monotonic.
      const tail = speechTailPoints(ox, oy, ow, oh, { x: 0.95, y: 1.6 })!;
      const cmds = balloonOutline(ox, oy, ow, oh, tail);
      // The tail sits on the bottom edge (y = oy+oh). Collect, in trace order,
      // the x of every vertex sitting on that edge; the tail makes the run dip
      // out to the tip and back, but the on-edge xs must stay within the flat
      // span and march monotonically right→left without overshooting a corner.
      const bottom = oy + oh;
      const onEdgeXs = cmds
        .filter((c) => c.k !== "A" && Math.abs((c as { y: number }).y - bottom) < eps)
        .map((c) => (c as { x: number }).x);
      // Every on-edge vertex is within the straight span (never on a corner).
      for (const x of onEdgeXs) {
        expect(x).toBeGreaterThanOrEqual(ox + r - eps);
        expect(x).toBeLessThanOrEqual(ox + ow - r + eps);
      }
      // …and strictly non-increasing (bottom edge is traced right→left), so the
      // path never reverses back toward the corner it just rounded.
      for (let i = 1; i < onEdgeXs.length; i++) {
        expect(onEdgeXs[i]).toBeLessThanOrEqual(onEdgeXs[i - 1] + eps);
      }
    });
  });
});

describe("defaultBalloonRadius — webtoon rounding (#363)", () => {
  it("rounds proportionally to the shorter side (a soft balloon, not a UI box)", () => {
    // A typical export-scale bubble. The old flat 8px cap was ~3% of the height
    // (nearly rectangular); the proportional radius is 40% of the shorter side.
    expect(defaultBalloonRadius(400, 240)).toBeCloseTo(96, 5); // 0.4 * 240
    expect(defaultBalloonRadius(240, 400)).toBeCloseTo(96, 5); // shorter side wins
    // Much rounder than the previous absolute 8px cap at export scale.
    expect(defaultBalloonRadius(400, 240)).toBeGreaterThan(8);
  });

  it("scales with size, so preview and export round identically (same %)", () => {
    // A preview-size and an export-size bubble of the same aspect ratio get the
    // same fraction of rounding — what keeps the two renderers visually matched.
    const small = defaultBalloonRadius(100, 60);
    const large = defaultBalloonRadius(400, 240);
    expect(small / 60).toBeCloseTo(large / 240, 5);
  });

  it("never exceeds half the shorter side (corner arcs can't overrun the body)", () => {
    for (const [w, h] of [[10, 10], [200, 4], [4, 200], [50, 50]]) {
      expect(defaultBalloonRadius(w, h)).toBeLessThanOrEqual(Math.min(w, h) / 2 + 1e-9);
      expect(defaultBalloonRadius(w, h)).toBeGreaterThanOrEqual(0);
    }
  });

  it("is the radius balloonOutline actually uses (single source of truth)", () => {
    const ox = 0, oy = 0, ow = 200, oh = 120;
    const cmds = balloonOutline(ox, oy, ow, oh, null);
    const r = defaultBalloonRadius(ow, oh);
    // The opening moveto starts r in from the top-left corner along the top edge.
    expect(cmds[0]).toMatchObject({ k: "M", x: ox + r, y: oy });
    expect(cmds.filter((c) => c.k === "A").every((c) => (c as { r: number }).r === r)).toBe(true);
  });
});

describe("balloonOutline (#341 — shared body+tail geometry)", () => {
  // Bubble rect: ox=100, oy=100, ow=200, oh=100 → bottom edge at y=200.
  const ox = 100, oy = 100, ow = 200, oh = 100;

  it("is one continuous outline: a single moveto, four rounded corners, tail folded in", () => {
    const tail = speechTailPoints(ox, oy, ow, oh, { x: 0.5, y: 1.2 });
    const cmds = balloonOutline(ox, oy, ow, oh, tail);
    // Exactly one move (start), four corner arcs (one per body corner).
    expect(cmds.filter((c) => c.k === "M")).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ k: "M" });
    expect(cmds.filter((c) => c.k === "A")).toHaveLength(4);
    // The tail tip is a vertex IN this same outline (folded into the perimeter),
    // not a separate shape — and it sits between its two base points.
    const tipIdx = cmds.findIndex((c) => c.k === "L" && Math.abs(c.x - tail!.tip.x) < 1e-9 && Math.abs(c.y - tail!.tip.y) < 1e-9);
    expect(tipIdx).toBeGreaterThan(0);
    expect(cmds[tipIdx - 1]).toMatchObject({ y: oy + oh }); // base on the bottom edge
    expect(cmds[tipIdx + 1]).toMatchObject({ y: oy + oh });
  });

  it("a tailless bubble is a plain rounded rectangle (4 corners, no out-of-rect vertex)", () => {
    const cmds = balloonOutline(ox, oy, ow, oh, null);
    expect(cmds.filter((c) => c.k === "A")).toHaveLength(4);
    const ys = cmds.filter((c) => c.k !== "A").map((c) => (c as { y: number }).y);
    expect(Math.max(...ys)).toBeLessThanOrEqual(oy + oh + 1e-9);
  });

  it("balloonPathD is derived from balloonOutline (same corner count, tip included)", () => {
    const tail = speechTailPoints(ox, oy, ow, oh, { x: 0.5, y: 1.2 });
    const d = balloonPathD(ox, oy, ow, oh, tail);
    const cmds = balloonOutline(ox, oy, ow, oh, tail);
    expect((d.match(/A /g) || []).length).toBe(cmds.filter((c) => c.k === "A").length);
    expect(d).toContain(`${tail!.tip.x} ${tail!.tip.y}`);
  });
});

describe("balloonPathD (#327)", () => {
  // Bubble rect: ox=100, oy=100, ow=200, oh=100 → bottom edge at y=200.
  const ox = 100, oy = 100, ow = 200, oh = 100;

  it("traces a plain rounded rectangle when there is no tail", () => {
    const d = balloonPathD(ox, oy, ow, oh, null);
    // One closed outline with rounded corners (arc commands).
    expect(d.startsWith("M")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
    expect((d.match(/A /g) || []).length).toBe(4); // four rounded corners
    // No point extends beyond the rect bounds.
    const ys = Array.from(d.matchAll(/[ML] [\d.-]+ ([\d.-]+)/g)).map((m) => parseFloat(m[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(oy + oh + 1e-9);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(oy - 1e-9);
  });

  it("folds a downward tail into the same continuous path (no separate shape)", () => {
    const tail = speechTailPoints(ox, oy, ow, oh, { x: 0.5, y: 1.2 });
    expect(tail).not.toBeNull();
    const d = balloonPathD(ox, oy, ow, oh, tail);
    // Still one closed path, still rounded corners.
    expect(d.startsWith("M")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
    expect((d.match(/A /g) || []).length).toBe(4);
    // The tail tip (y=220, below the bottom edge at 200) is part of THIS path.
    expect(d).toContain(`${tail!.tip.x} ${tail!.tip.y}`);
    const ys = Array.from(d.matchAll(/[ML] [\d.-]+ ([\d.-]+)/g)).map((m) => parseFloat(m[1]));
    expect(Math.max(...ys)).toBe(220);
  });

  it("folds a sideways tail into the right edge of the path", () => {
    const tail = speechTailPoints(ox, oy, ow, oh, { x: 1.3, y: 0.5 });
    const d = balloonPathD(ox, oy, ow, oh, tail);
    // Tail tip at x=360 (right of the 300 edge) is included along the path.
    expect(d).toContain(`${tail!.tip.x} ${tail!.tip.y}`);
    const xs = Array.from(d.matchAll(/[ML] ([\d.-]+) [\d.-]+/g)).map((m) => parseFloat(m[1]));
    expect(Math.max(...xs)).toBe(360);
  });

  it("honors an explicit corner radius", () => {
    const d0 = balloonPathD(ox, oy, ow, oh, null, 0);
    // Radius 0 → corner arcs collapse onto the rect corners (still emitted but
    // degenerate); the moveto starts exactly at the top-left corner.
    expect(d0.startsWith(`M ${ox} ${oy}`)).toBe(true);
  });
});

describe("anchorFromPosition (#309)", () => {
  it("maps corner/edge keywords to a top-left anchor for the box", () => {
    const w = 0.4, h = 0.16;
    expect(anchorFromPosition("upper-left", w, h)).toEqual({ x: 0.05, y: 0.05 });
    expect(anchorFromPosition("top left", w, h)).toEqual({ x: 0.05, y: 0.05 });
    const ur = anchorFromPosition("upper-right", w, h)!;
    expect(ur.x).toBeCloseTo(1 - w - 0.05);
    expect(ur.y).toBe(0.05);
    const bc = anchorFromPosition("bottom-center", w, h)!;
    expect(bc.x).toBeCloseTo((1 - w) / 2);
    expect(bc.y).toBeCloseTo(1 - h - 0.05);
    expect(anchorFromPosition("center", w, h)!.y).toBeCloseTo((1 - h) / 2);
  });

  it("returns null for an unrecognized position", () => {
    expect(anchorFromPosition("somewhere", 0.4, 0.16)).toBeNull();
    expect(anchorFromPosition("", 0.4, 0.16)).toBeNull();
  });
});

describe("normalizeOverlay (#309)", () => {
  it("repairs a semantic-position overlay into valid numeric geometry", () => {
    const o = normalizeOverlay({ type: "speech", speaker: "Hana", text: "Hi", position: "upper-left" });
    expect(o).not.toBeNull();
    expect(o!.type).toBe("speech");
    expect(typeof o!.id).toBe("string");
    expect(Number.isFinite(o!.x)).toBe(true);
    expect(Number.isFinite(o!.y)).toBe(true);
    expect(o!.width).toBeGreaterThan(0);
    expect(o!.height).toBeGreaterThan(0);
    expect(o!.speaker).toBe("Hana");
    expect(o!.tailAnchor).toEqual({ x: 0.5, y: 1.2 }); // default tail filled
  });

  it("preserves an already-valid overlay (incl. id and tailAnchor)", () => {
    const valid = { id: "ov-1", type: "speech", x: 0.1, y: 0.2, width: 0.3, height: 0.15, text: "Yo", speaker: "Min", tailAnchor: { x: 0.4, y: 1.1 } };
    const o = normalizeOverlay(valid);
    expect(o).toEqual(valid);
  });

  it("returns null when there is no numeric geometry and no recognizable position", () => {
    expect(normalizeOverlay({ type: "speech", text: "orphan" })).toBeNull();
    expect(normalizeOverlay({ type: "speech", text: "orphan", position: "nowhere" })).toBeNull();
    expect(normalizeOverlay(null)).toBeNull();
    expect(normalizeOverlay("nope")).toBeNull();
  });

  it("clamps numeric geometry into range and defaults an unknown type to speech", () => {
    const o = normalizeOverlay({ type: "weird", x: 2, y: -1, width: 5, height: 0.1, text: "" })!;
    expect(o.type).toBe("speech");
    expect(o.x).toBe(1);
    expect(o.y).toBe(0);
    expect(o.width).toBe(1);
  });
});

describe("normalizeOverlays (#309)", () => {
  it("keeps placeable overlays, drops un-placeable ones, and flags changed", () => {
    const res = normalizeOverlays([
      { id: "a", type: "speech", x: 0.1, y: 0.1, width: 0.2, height: 0.1, text: "ok" }, // canonical
      { type: "narration", text: "caption", position: "bottom" },                       // repairable
      { type: "speech", text: "orphan" },                                               // invalid
    ]);
    expect(res.overlays).toHaveLength(2);
    expect(res.invalid).toHaveLength(1);
    expect(res.invalid[0].index).toBe(2);
    expect(res.changed).toBe(true);
  });

  it("reports no change for an all-canonical array", () => {
    const res = normalizeOverlays([
      { id: "a", type: "narration", x: 0.1, y: 0.1, width: 0.2, height: 0.1, text: "ok" },
    ]);
    expect(res.changed).toBe(false);
    expect(res.invalid).toEqual([]);
  });

  it("treats a non-array as empty + changed", () => {
    expect(normalizeOverlays(undefined)).toEqual({ overlays: [], changed: true, invalid: [] });
  });
});

describe("validateOverlaysForExport (#309)", () => {
  it("passes when every overlay has finite positive geometry", () => {
    const ok = validateOverlaysForExport([
      { id: "a", type: "speech", x: 0.1, y: 0.1, width: 0.2, height: 0.1, text: "" },
    ]);
    expect(ok.valid).toBe(true);
  });

  it("blocks an overlay with missing/NaN geometry, naming it", () => {
    const bad = validateOverlaysForExport([
      // semantic-position overlay that escaped normalization → NaN geometry
      { id: "a", type: "speech", text: "", x: NaN, y: 0.1, width: 0.2, height: 0.1 } as unknown as Parameters<typeof validateOverlaysForExport>[0][number],
    ]);
    expect(bad.valid).toBe(false);
    expect(bad.error).toMatch(/invalid geometry/);
  });

  it("blocks zero/negative width", () => {
    const bad = validateOverlaysForExport([
      { id: "a", type: "sfx", x: 0.1, y: 0.1, width: 0, height: 0.1, text: "" },
    ]);
    expect(bad.valid).toBe(false);
  });
});

describe("detectOverlappingOverlays (#318)", () => {
  type O = Parameters<typeof detectOverlappingOverlays>[0][number];
  const speech = (id: string, x: number, y: number, w = 0.3, h = 0.2, over: Partial<O> = {}): O =>
    ({ id, type: "speech", x, y, width: w, height: h, text: "", ...over });

  it("returns no pairs for a single bubble", () => {
    expect(detectOverlappingOverlays([speech("a", 0.1, 0.1)])).toEqual([]);
  });

  it("returns no pairs for bubbles that do not touch", () => {
    const pairs = detectOverlappingOverlays([speech("a", 0.0, 0.0), speech("b", 0.6, 0.6)]);
    expect(pairs).toEqual([]);
  });

  it("flags two heavily overlapping bubbles with their indexes and ids", () => {
    // a covers [0.1,0.4]x[0.1,0.3]; b covers [0.2,0.5]x[0.15,0.35] → large overlap.
    const pairs = detectOverlappingOverlays([speech("a", 0.1, 0.1), speech("b", 0.2, 0.15)]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ indexA: 0, indexB: 1, idA: "a", idB: "b" });
    expect(pairs[0].ratio).toBeGreaterThan(OVERLAP_AREA_THRESHOLD);
  });

  it("ignores a tiny nick below the readability threshold", () => {
    // b's top-left corner just clips a's bottom-right corner: intersection is a
    // sliver, well under 12% of the smaller bubble.
    const pairs = detectOverlappingOverlays([
      speech("a", 0.1, 0.1, 0.3, 0.2),
      speech("b", 0.39, 0.29, 0.3, 0.2),
    ]);
    expect(pairs).toEqual([]);
  });

  it("does not flag overlap involving an SFX overlay (transparent, non-occluding)", () => {
    const pairs = detectOverlappingOverlays([
      speech("a", 0.1, 0.1, 0.3, 0.2),
      { id: "f", type: "sfx", x: 0.12, y: 0.12, width: 0.3, height: 0.2, text: "BOOM" },
    ]);
    expect(pairs).toEqual([]);
  });

  it("flags an overlapping speech/narration pair", () => {
    const pairs = detectOverlappingOverlays([
      speech("a", 0.1, 0.1, 0.3, 0.2),
      { id: "n", type: "narration", x: 0.15, y: 0.12, width: 0.3, height: 0.2, text: "..." },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ idA: "a", idB: "n" });
  });

  it("reports every overlapping pair among three stacked bubbles", () => {
    const pairs = detectOverlappingOverlays([
      speech("a", 0.1, 0.1, 0.4, 0.4),
      speech("b", 0.15, 0.15, 0.4, 0.4),
      speech("c", 0.2, 0.2, 0.4, 0.4),
    ]);
    expect(pairs.map((p) => [p.idA, p.idB])).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ]);
  });

  it("skips overlays with non-finite geometry rather than throwing", () => {
    const pairs = detectOverlappingOverlays([
      { id: "bad", type: "speech", x: NaN, y: 0.1, width: 0.3, height: 0.2, text: "" } as unknown as O,
      speech("b", 0.1, 0.1),
    ]);
    expect(pairs).toEqual([]);
  });
});

describe("isOverlayOutOfBounds (#336)", () => {
  const box = (x: number, y: number, width: number, height: number) =>
    ({ x, y, width, height });

  it("is false for a box fully inside the image (incl. flush against edges)", () => {
    expect(isOverlayOutOfBounds(box(0.1, 0.1, 0.3, 0.3))).toBe(false);
    expect(isOverlayOutOfBounds(box(0, 0, 1, 1))).toBe(false); // exactly the full frame
  });

  it("is true when the box extends past any edge", () => {
    expect(isOverlayOutOfBounds(box(-0.01, 0.1, 0.3, 0.3))).toBe(true); // off the left
    expect(isOverlayOutOfBounds(box(0.1, -0.01, 0.3, 0.3))).toBe(true); // off the top
    expect(isOverlayOutOfBounds(box(0.8, 0.1, 0.3, 0.3))).toBe(true);   // past the right
    expect(isOverlayOutOfBounds(box(0.1, 0.8, 0.3, 0.3))).toBe(true);   // past the bottom
  });
});

describe("hasVisibleSpeechTail (#381)", () => {
  it("is true for a speech overlay whose tail tip falls outside the bubble", () => {
    expect(hasVisibleSpeechTail({ type: "speech", tailAnchor: { x: 0.5, y: 1.2 } })).toBe(true); // below
    expect(hasVisibleSpeechTail({ type: "speech", tailAnchor: { x: 1.3, y: 0.5 } })).toBe(true); // right
  });
  it("is false when the tail tip is inside the bubble (no tail drawn)", () => {
    expect(hasVisibleSpeechTail({ type: "speech", tailAnchor: { x: 0.5, y: 0.5 } })).toBe(false);
  });
  it("is false for a speech overlay with no tailAnchor", () => {
    expect(hasVisibleSpeechTail({ type: "speech" })).toBe(false);
  });
  it("is false for non-speech overlays even with a tailAnchor", () => {
    expect(hasVisibleSpeechTail({ type: "narration", tailAnchor: { x: 0.5, y: 1.2 } })).toBe(false);
    expect(hasVisibleSpeechTail({ type: "sfx", tailAnchor: { x: 0.5, y: 1.2 } })).toBe(false);
  });
});

describe("CARTOON_BUBBLE_RENDERER_VERSION (#381)", () => {
  it("is a positive integer the export stamps and stale-detection compares against", () => {
    expect(Number.isInteger(CARTOON_BUBBLE_RENDERER_VERSION)).toBe(true);
    expect(CARTOON_BUBBLE_RENDERER_VERSION).toBeGreaterThan(0);
  });
});
