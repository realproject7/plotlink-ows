import { describe, it, expect } from "vitest";
import { validateExportSize, MAX_SIZE, renderOverlays, exportCut, textPanelDimensions } from "./export-cut";

interface Overlay {
  id: string;
  type: "speech" | "narration" | "sfx";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  speaker?: string;
  tailAnchor?: { x: number; y: number };
  textStyle?: {
    mode?: "auto" | "manual";
    fontScale?: number;
    lineHeightFactor?: number;
    speakerScale?: number;
  };
  bubbleStyle?: {
    paddingX?: number;
    paddingY?: number;
    cornerRadius?: number;
  };
}

// Minimal recording stand-in for CanvasRenderingContext2D: captures the path
// vertices (moveTo/lineTo, in order) plus fill/stroke counts so we can assert
// what geometry was actually drawn.
function recordingCtx() {
  const lineTos: Array<{ x: number; y: number }> = [];
  const moveTos: Array<{ x: number; y: number }> = [];
  // Ordered moveTo/lineTo vertices, so we can check traversal order (e.g. that
  // the tail tip is reached between its two base points).
  const path: Array<{ op: "M" | "L"; x: number; y: number }> = [];
  const counts = { fill: 0, stroke: 0 };
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    beginPath() {},
    closePath() {},
    moveTo(x: number, y: number) { moveTos.push({ x, y }); path.push({ op: "M", x, y }); },
    lineTo(x: number, y: number) { lineTos.push({ x, y }); path.push({ op: "L", x, y }); },
    arcTo() {},
    measureText(this: { font: string }, text: string) {
      const fs = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? "10");
      return { width: text.length * fs * 0.5 } as TextMetrics;
    },
    roundRect() {},
    rect() {},
    fill() { counts.fill++; },
    stroke() { counts.stroke++; },
    fillRect() {},
    strokeRect() {},
    fillText() {},
    strokeText() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, lineTos, moveTos, path, counts };
}

function speechOverlay(over: Partial<Overlay> = {}): Overlay {
  return { id: "s1", type: "speech", x: 0, y: 0, width: 0.25, height: 0.12, text: "Hi", speaker: "Ada", ...over };
}

describe("validateExportSize", () => {
  it("accepts blob under 1MB", () => {
    const blob = new Blob([new Uint8Array(500 * 1024)]);
    expect(validateExportSize(blob)).toEqual({ valid: true });
  });

  it("accepts blob at exactly 1MB", () => {
    const blob = new Blob([new Uint8Array(MAX_SIZE)]);
    expect(validateExportSize(blob)).toEqual({ valid: true });
  });

  it("rejects blob over 1MB", () => {
    const blob = new Blob([new Uint8Array(MAX_SIZE + 1)]);
    const result = validateExportSize(blob);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("1MB");
  });

  it("reports size in KB in error message", () => {
    const blob = new Blob([new Uint8Array(1500 * 1024)]);
    const result = validateExportSize(blob);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("1500");
  });
});

describe("renderOverlays speech-bubble tail", () => {
  // 800x600 canvas, speech bubble at ox=0, oy=0, ow=200, oh=72.
  // tailAnchor {0.5, 1.2} → tip = (0.5*200, 1.2*72) = (100, 86.4), below the
  // bubble bottom (72), so a tail must be drawn to that tip.
  it("draws the tail to the anchored tip when tailAnchor is present", () => {
    const { ctx, lineTos } = recordingCtx();
    renderOverlays(ctx, [speechOverlay({ tailAnchor: { x: 0.5, y: 1.2 } })], 800, 600, "Body", "Display");
    const hitsTip = lineTos.some((p) => Math.abs(p.x - 100) < 0.001 && Math.abs(p.y - 86.4) < 0.001);
    expect(hitsTip).toBe(true);
  });

  it("draws a plain rounded-rect balloon (no tail detour) for a speech bubble without a tailAnchor", () => {
    // The body outline now traces with lineTo, so a tail is detected by an
    // out-of-bubble vertex (the tip), not by the mere presence of a lineTo.
    // ox=0,oy=0,ow=200,oh=72 → every body vertex stays inside the bubble rect.
    const { ctx, path, counts } = recordingCtx();
    renderOverlays(ctx, [speechOverlay({ tailAnchor: undefined })], 800, 600, "Body", "Display");
    expect(path.some((p) => p.y > 72.001 || p.x > 200.001 || p.x < -0.001 || p.y < -0.001)).toBe(false);
    // Still a single integrated balloon: one fill, one stroke.
    expect(counts.fill).toBe(1);
    expect(counts.stroke).toBe(1);
  });

  it("draws a plain rounded-rect balloon (no tail detour) when the anchor sits inside the bubble", () => {
    const { ctx, path } = recordingCtx();
    renderOverlays(ctx, [speechOverlay({ tailAnchor: { x: 0.5, y: 0.5 } })], 800, 600, "Body", "Display");
    // tip (100, 36) is inside → speechTailPoints returns null → no tail detour,
    // so no vertex escapes the bubble rect.
    expect(path.some((p) => p.y > 72.001 || p.x > 200.001 || p.x < -0.001 || p.y < -0.001)).toBe(false);
  });

  it("renders the body and tail as one integrated outline with no internal seam (#317)", () => {
    // ox=0,oy=0,ow=200,oh=72; tailAnchor {0.5,1.2} → bottom-edge tail.
    // base points: bx=100, baseW=min(200,72)*0.3=21.6 → base1=(89.2,72),
    // base2=(110.8,72); tip=(100,86.4).
    const { ctx, path, counts } = recordingCtx();
    renderOverlays(ctx, [speechOverlay({ tailAnchor: { x: 0.5, y: 1.2 } })], 800, 600, "Body", "Display");

    // A single integrated shape: exactly one fill and one stroke for the
    // balloon (the pre-fix code filled + stroked the tail and body separately,
    // which is what stroked a seam line across the tail mouth).
    expect(counts.fill).toBe(1);
    expect(counts.stroke).toBe(1);

    // The outline detours through the tail tip *between* its two base points:
    // on the bottom edge (traced right→left) that is base2 → tip → base1.
    const tipIdx = path.findIndex((p) => Math.abs(p.x - 100) < 1e-6 && Math.abs(p.y - 86.4) < 1e-6);
    expect(tipIdx).toBeGreaterThan(0);
    const before = path[tipIdx - 1];
    const after = path[tipIdx + 1];
    expect(before.x).toBeCloseTo(110.8, 5);
    expect(before.y).toBeCloseTo(72, 5);
    expect(after.x).toBeCloseTo(89.2, 5);
    expect(after.y).toBeCloseTo(72, 5);

    // No seam: the bottom border never runs straight between the two tail bases
    // (which is the line that produced the visible body/tail boundary). Every
    // adjacent vertex pair on y=72 must be interrupted by the tip.
    const onBottom = (p: { x: number; y: number }) => Math.abs(p.y - 72) < 1e-6;
    const seam = path.some((p, i) => {
      const q = path[i + 1];
      if (!q) return false;
      const a = Math.round(p.x * 10) / 10;
      const b = Math.round(q.x * 10) / 10;
      return onBottom(p) && onBottom(q) &&
        ((a === 89.2 && b === 110.8) || (a === 110.8 && b === 89.2));
    });
    expect(seam).toBe(false);
  });

  // #341: the export canvas and the editor-preview SVG must trace the IDENTICAL
  // outline. Both now come from the shared balloonOutline, so the canvas op
  // sequence (moveTo/lineTo/arcTo) must equal that command list exactly — one
  // unified path, tail folded in, no separate tail primitive.
  it("traces the shared balloonOutline command-for-command (preview == export)", async () => {
    const { speechTailPoints, balloonOutline } = await import("@app-lib/overlays");
    // ox=0,oy=0,ow=200,oh=72 (matches speechOverlay at 800x600).
    const tail = speechTailPoints(0, 0, 200, 72, { x: 0.5, y: 1.2 });
    const expected = balloonOutline(0, 0, 200, 72, tail);

    const ops: Array<{ op: string; args: number[] }> = [];
    const ctx = {
      fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "", textBaseline: "",
      beginPath() { ops.push({ op: "begin", args: [] }); },
      closePath() { ops.push({ op: "close", args: [] }); },
      moveTo(x: number, y: number) { ops.push({ op: "M", args: [x, y] }); },
      lineTo(x: number, y: number) { ops.push({ op: "L", args: [x, y] }); },
      arcTo(x1: number, y1: number, x2: number, y2: number, r: number) { ops.push({ op: "A", args: [x1, y1, x2, y2, r] }); },
      measureText() { return { width: 10 } as TextMetrics; },
      fillText() {}, strokeText() {}, fill() {}, stroke() {}, fillRect() {}, strokeRect() {},
    };
    renderOverlays(ctx as unknown as CanvasRenderingContext2D, [speechOverlay({ tailAnchor: { x: 0.5, y: 1.2 } })], 800, 600, "Body", "Display");

    // Exactly one balloon sub-path.
    expect(ops.filter((o) => o.op === "begin")).toHaveLength(1);
    expect(ops.filter((o) => o.op === "close")).toHaveLength(1);
    // The path ops, in order, equal the shared outline.
    const pathOps = ops.filter((o) => ["M", "L", "A"].includes(o.op));
    const asShared = pathOps.map((o) =>
      o.op === "A"
        ? { k: "A", cornerX: o.args[0], cornerY: o.args[1], x: o.args[2], y: o.args[3], r: o.args[4] }
        : { k: o.op, x: o.args[0], y: o.args[1] },
    );
    expect(asShared).toEqual(expected);
  });

  it("does not draw a tail for narration or sfx overlays", () => {
    const { ctx, lineTos } = recordingCtx();
    renderOverlays(
      ctx,
      [
        { id: "n1", type: "narration", x: 0, y: 0, width: 0.25, height: 0.12, text: "..." },
        { id: "f1", type: "sfx", x: 0.5, y: 0.5, width: 0.15, height: 0.08, text: "BOOM" },
      ],
      800,
      600,
      "Body",
      "Display",
    );
    expect(lineTos).toHaveLength(0);
  });
});

// Capture the fill/stroke STYLES (not just counts) and roundRect calls, so we
// can assert the webtoon balloon styling (#363).
function styleCtx() {
  const fills: Array<{ style: string }> = [];
  const strokes: Array<{ style: string; width: number; join: string }> = [];
  const roundRects: Array<{ x: number; y: number; w: number; h: number; r: number }> = [];
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 0, lineJoin: "", font: "", textAlign: "", textBaseline: "",
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {},
    measureText(this: { font: string }, t: string) {
      const fs = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? "10");
      return { width: t.length * fs * 0.5 } as TextMetrics;
    },
    roundRect(x: number, y: number, w: number, h: number, r: number) { roundRects.push({ x, y, w, h, r }); },
    rect() {},
    fill(this: { fillStyle: string }) { fills.push({ style: this.fillStyle }); },
    stroke(this: { strokeStyle: string; lineWidth: number; lineJoin: string }) {
      strokes.push({ style: this.strokeStyle, width: this.lineWidth, join: this.lineJoin });
    },
    fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes, roundRects };
}

describe("renderOverlays webtoon balloon styling (#363)", () => {
  it("strokes a speech balloon with a strong near-black, rounded-join outline", () => {
    const { ctx, fills, strokes } = styleCtx();
    renderOverlays(ctx, [speechOverlay({ tailAnchor: { x: 0.5, y: 1.2 } })], 800, 600, "Body", "Display");
    // One balloon fill (near-opaque white) + one strong dark stroke.
    expect(fills[0].style).toBe("rgba(255, 255, 255, 0.95)");
    expect(strokes).toHaveLength(1);
    expect(strokes[0].style).toBe("#1a1a1a");
    expect(strokes[0].join).toBe("round");
    // Not the old 1px hairline.
    expect(strokes[0].width).toBeGreaterThan(1);
  });

  it("scales the balloon outline weight with the panel height (consistent at any export size)", () => {
    const small = styleCtx();
    renderOverlays(small.ctx, [speechOverlay({})], 800, 600, "Body", "Display");
    const large = styleCtx();
    renderOverlays(large.ctx, [speechOverlay({})], 2000, 1500, "Body", "Display");
    expect(small.strokes[0].width).toBeCloseTo(Math.max(2, 600 * 0.004), 5);
    expect(large.strokes[0].width).toBeCloseTo(Math.max(2, 1500 * 0.004), 5);
    expect(large.strokes[0].width).toBeGreaterThan(small.strokes[0].width);
  });

  it("draws narration as a rounded parchment card, not a hairline box", () => {
    const { ctx, fills, strokes, roundRects } = styleCtx();
    renderOverlays(ctx, [{ id: "n", type: "narration", x: 0, y: 0, width: 0.25, height: 0.12, text: "Later that night." }], 800, 600, "Body", "Display");
    // Rounded card (roundRect with a positive radius), not a square fillRect/strokeRect box.
    expect(roundRects).toHaveLength(1);
    expect(roundRects[0].r).toBeGreaterThan(0);
    expect(fills[0].style).toBe("rgba(244, 239, 230, 0.94)");
    expect(strokes[0].style).toBe("rgba(26, 26, 26, 0.55)");
  });
});

describe("textPanelDimensions (#351)", () => {
  it("sizes a text panel canvas from a W:H aspect ratio (base width 800)", () => {
    expect(textPanelDimensions("4:5")).toEqual({ width: 800, height: 1000 });
    expect(textPanelDimensions("16:9")).toEqual({ width: 800, height: 450 });
    expect(textPanelDimensions("1:1")).toEqual({ width: 800, height: 800 });
  });
  it("returns null for missing or malformed ratios (caller falls back to 800x600)", () => {
    expect(textPanelDimensions(undefined)).toBeNull();
    expect(textPanelDimensions("portrait")).toBeNull();
    expect(textPanelDimensions("4:0")).toBeNull();
    expect(textPanelDimensions("0:5")).toBeNull();
  });
});

describe("MAX_SIZE constant", () => {
  it("is 1MB in bytes", () => {
    expect(MAX_SIZE).toBe(1024 * 1024);
  });
});

describe("WebP fallback detection", () => {
  it("detects non-WebP blob type as unsupported", () => {
    const pngBlob = new Blob([new Uint8Array(100)], { type: "image/png" });
    expect(pngBlob.type).not.toBe("image/webp");
  });

  it("accepts actual WebP blob type", () => {
    const webpBlob = new Blob([new Uint8Array(100)], { type: "image/webp" });
    expect(webpBlob.type).toBe("image/webp");
  });

  it("JPEG blob type is valid for fallback", () => {
    const jpegBlob = new Blob([new Uint8Array(100)], { type: "image/jpeg" });
    expect(jpegBlob.type).toBe("image/jpeg");
  });
});

// Captures fillText(text, x, y) so we can assert wrapped, multi-line body text.
function textRecordingCtx() {
  const fillTexts: Array<{ text: string; x: number; y: number }> = [];
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "", textBaseline: "",
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, roundRect() {}, rect() {},
    fill() {}, stroke() {}, fillRect() {}, strokeRect() {},
    measureText(this: { font: string }, text: string) {
      const fs = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? "10");
      return { width: text.length * fs * 0.5 } as TextMetrics;
    },
    fillText(text: string, x: number, y: number) { fillTexts.push({ text, x, y }); },
    strokeText() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillTexts };
}

describe("renderOverlays text wrapping (#310)", () => {
  const longLine = "the quick brown fox jumps over the lazy dog and then keeps running";

  it("wraps long speech dialogue across multiple lines instead of one compressed line", () => {
    const { ctx, fillTexts } = textRecordingCtx();
    renderOverlays(ctx, [{ id: "s", type: "speech", x: 0.05, y: 0.05, width: 0.4, height: 0.25, text: longLine }], 800, 600, "Body", "Display");
    // More than one body line drawn, each at a distinct vertical position.
    expect(fillTexts.length).toBeGreaterThan(1);
    const ys = new Set(fillTexts.map((f) => Math.round(f.y)));
    expect(ys.size).toBeGreaterThan(1);
    // The original text was split (no single fillText carries the whole line).
    expect(fillTexts.some((f) => f.text === longLine)).toBe(false);
    // All words preserved across the drawn lines.
    expect(fillTexts.map((f) => f.text).join(" ")).toBe(longLine);
  });

  it("draws the speaker label plus wrapped body for a speech overlay with a speaker", () => {
    const { ctx, fillTexts } = textRecordingCtx();
    renderOverlays(ctx, [{ id: "s", type: "speech", x: 0.05, y: 0.05, width: 0.4, height: 0.25, text: longLine, speaker: "Hana" }], 800, 600, "Body", "Display");
    expect(fillTexts.some((f) => f.text === "Hana")).toBe(true);
    // Body still wrapped beneath the speaker.
    expect(fillTexts.filter((f) => f.text !== "Hana").length).toBeGreaterThan(1);
  });

  it("wraps narration text across multiple lines", () => {
    const n = textRecordingCtx();
    renderOverlays(n.ctx, [{ id: "n", type: "narration", x: 0.05, y: 0.05, width: 0.4, height: 0.25, text: longLine }], 800, 600, "Body", "Display");
    expect(n.fillTexts.length).toBeGreaterThan(1);
  });

  it("wraps SFX text too (not forced onto one compressed line)", () => {
    const s = textRecordingCtx();
    renderOverlays(s.ctx, [{ id: "f", type: "sfx", x: 0.05, y: 0.05, width: 0.5, height: 0.2, text: "crash bang boom wallop smash" }], 800, 600, "Body", "Display");
    // SFX uses stroke+fill per line; assert multiple distinct fill lines drawn.
    expect(s.fillTexts.length).toBeGreaterThan(1);
  });

  it("uses manual typography and bubble padding controls when present", () => {
    const manual = textRecordingCtx();
    renderOverlays(
      manual.ctx,
      [{
        id: "m",
        type: "speech",
        x: 0.05,
        y: 0.05,
        width: 0.4,
        height: 0.25,
        text: longLine,
        textStyle: { mode: "manual", fontScale: 0.06, lineHeightFactor: 1.4 },
        bubbleStyle: { paddingX: 0.14, paddingY: 0.12 },
      }],
      800,
      600,
      "Body",
      "Display",
    );
    const auto = textRecordingCtx();
    renderOverlays(auto.ctx, [{ id: "a", type: "speech", x: 0.05, y: 0.05, width: 0.4, height: 0.25, text: longLine }], 800, 600, "Body", "Display");
    expect(manual.fillTexts.length).toBeGreaterThan(auto.fillTexts.length);
  });

  it("uses manual corner radius when tracing a speech balloon", () => {
    const rounded = recordingCtx();
    renderOverlays(
      rounded.ctx,
      [speechOverlay({ bubbleStyle: { cornerRadius: 0.1 } })],
      800,
      600,
      "Body",
      "Display",
    );
    const soft = recordingCtx();
    renderOverlays(
      soft.ctx,
      [speechOverlay({ bubbleStyle: { cornerRadius: 0.45 } })],
      800,
      600,
      "Body",
      "Display",
    );
    expect(rounded.moveTos[0].x).toBeCloseTo(7.2, 3);
    expect(soft.moveTos[0].x).toBeCloseTo(32.4, 3);
  });
});

describe("exportCut overlay-geometry guard (#309)", () => {
  it("rejects (does not silently produce an unlettered image) when an overlay has invalid geometry", async () => {
    // A malformed/semantic-position overlay that reached export with NaN geometry.
    const bad = [{ id: "a", type: "speech", text: "Hi", x: NaN, y: 0.1, width: 0.3, height: 0.15 }] as unknown as Parameters<typeof exportCut>[1];
    await expect(exportCut(null, bad, "sans", "sans")).rejects.toThrow(/invalid geometry/);
  });
});

describe("export draws a tailed speech bubble as ONE shape (#381)", () => {
  // Acceptance #1: the export must FAIL if body and tail are rendered as
  // separate stroked shapes. A single tailed speech bubble draws exactly one
  // fill + one stroke, from one begin/close sub-path, with the tail tip folded
  // into that single outline — never a second triangle/polygon.
  it("a tailed speech bubble exports as exactly one fill + one stroke, tip in the single path", () => {
    const { ctx, counts, path } = recordingCtx();
    renderOverlays(ctx, [speechOverlay({ tailAnchor: { x: 0.5, y: 1.2 } })], 800, 600, "Body", "Display");
    // ox=0,oy=0,ow=200,oh=72 → tip = (100, 86.4), below the bubble bottom.
    expect(counts.fill).toBe(1);
    expect(counts.stroke).toBe(1);
    const tip = path.find((p) => Math.abs(p.x - 100) < 1e-6 && Math.abs(p.y - 86.4) < 1e-6);
    expect(tip).toBeTruthy(); // the tail tip is a vertex of the single body outline
  });

  it("exports the SAME single fill+stroke whether or not the bubble has a tail (no extra tail shape)", () => {
    const withTail = recordingCtx();
    renderOverlays(withTail.ctx, [speechOverlay({ tailAnchor: { x: 0.5, y: 1.2 } })], 800, 600, "Body", "Display");
    const noTail = recordingCtx();
    renderOverlays(noTail.ctx, [speechOverlay({ tailAnchor: undefined })], 800, 600, "Body", "Display");
    // A tail must NOT add a second fill/stroke — it's a detour in the one path.
    expect(withTail.counts.fill).toBe(noTail.counts.fill);
    expect(withTail.counts.stroke).toBe(noTail.counts.stroke);
    expect(withTail.counts.fill).toBe(1);
    expect(withTail.counts.stroke).toBe(1);
  });
});
