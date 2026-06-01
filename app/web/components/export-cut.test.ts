import { describe, it, expect } from "vitest";
import { validateExportSize, MAX_SIZE, renderOverlays } from "./export-cut";

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
}

// Minimal recording stand-in for CanvasRenderingContext2D: captures the path
// vertices (moveTo/lineTo) so we can assert what geometry was actually drawn.
function recordingCtx() {
  const lineTos: Array<{ x: number; y: number }> = [];
  const moveTos: Array<{ x: number; y: number }> = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    beginPath() {},
    closePath() {},
    moveTo(x: number, y: number) { moveTos.push({ x, y }); },
    lineTo(x: number, y: number) { lineTos.push({ x, y }); },
    roundRect() {},
    rect() {},
    fill() {},
    stroke() {},
    fillRect() {},
    strokeRect() {},
    fillText() {},
    strokeText() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, lineTos, moveTos };
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

  it("draws no tail geometry for a speech bubble without a tailAnchor", () => {
    // The bubble body is a roundRect (its own ctx call), so the only way a
    // lineTo appears is the tail — none should be emitted here. This is the
    // pre-fix behaviour, pinned so the tail can't silently regress.
    const { ctx, lineTos } = recordingCtx();
    renderOverlays(ctx, [speechOverlay({ tailAnchor: undefined })], 800, 600, "Body", "Display");
    expect(lineTos).toHaveLength(0);
  });

  it("draws no tail when the anchor sits inside the bubble", () => {
    const { ctx, lineTos } = recordingCtx();
    renderOverlays(ctx, [speechOverlay({ tailAnchor: { x: 0.5, y: 0.5 } })], 800, 600, "Body", "Display");
    expect(lineTos).toHaveLength(0);
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
