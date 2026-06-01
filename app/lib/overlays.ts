export const OVERLAY_TYPES = ["speech", "narration", "sfx"] as const;
export type OverlayType = (typeof OVERLAY_TYPES)[number];

export interface Overlay {
  id: string;
  type: OverlayType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  speaker?: string;
  tailAnchor?: { x: number; y: number };
}

export function toPixel(norm: number, containerSize: number): number {
  return norm * containerSize;
}

export function toNorm(pixel: number, containerSize: number): number {
  if (containerSize === 0) return 0;
  return pixel / containerSize;
}

export interface Point {
  x: number;
  y: number;
}

export interface TailPoints {
  tip: Point;
  base1: Point;
  base2: Point;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Geometry for a speech-bubble tail, in the same pixel space as the bubble rect.
 *
 * `tailAnchor` is bubble-relative and normalized: x runs 0→1 across the bubble
 * width, y runs 0→1 down the bubble height, and values outside [0,1] place the
 * tip beyond the bubble edges (the default {x:0.5, y:1.2} points straight down
 * to the speaker). Returns the tip plus the two base points where the tail
 * meets the bubble border, or null when the tip falls inside the bubble (no
 * visible tail to draw). Shared by the export canvas and the editor preview so
 * both render the tail identically.
 */
export function speechTailPoints(
  ox: number,
  oy: number,
  ow: number,
  oh: number,
  tail: Point,
): TailPoints | null {
  const cx = ox + ow / 2;
  const cy = oy + oh / 2;
  const tipX = ox + tail.x * ow;
  const tipY = oy + tail.y * oh;

  // Tip inside the bubble → nothing meaningful to draw.
  if (tipX >= ox && tipX <= ox + ow && tipY >= oy && tipY <= oy + oh) return null;

  const dx = tipX - cx;
  const dy = tipY - cy;
  const baseW = Math.max(6, Math.min(ow, oh) * 0.3);

  // Anchor the base to the edge the tail points toward, perpendicular to the
  // dominant direction, so the triangle reads as a comic speech tail.
  if (Math.abs(dy) >= Math.abs(dx)) {
    const edgeY = dy >= 0 ? oy + oh : oy;
    const bx = clamp(tipX, ox + baseW / 2, ox + ow - baseW / 2);
    return {
      tip: { x: tipX, y: tipY },
      base1: { x: bx - baseW / 2, y: edgeY },
      base2: { x: bx + baseW / 2, y: edgeY },
    };
  }
  const edgeX = dx >= 0 ? ox + ow : ox;
  const by = clamp(tipY, oy + baseW / 2, oy + oh - baseW / 2);
  return {
    tip: { x: tipX, y: tipY },
    base1: { x: edgeX, y: by - baseW / 2 },
    base2: { x: edgeX, y: by + baseW / 2 },
  };
}

let counter = 0;

export function createOverlay(type: OverlayType, x = 0.1, y = 0.1): Overlay {
  counter++;
  return {
    id: `overlay-${Date.now()}-${counter}`,
    type,
    x,
    y,
    width: type === "sfx" ? 0.15 : 0.25,
    height: type === "sfx" ? 0.08 : 0.12,
    text: "",
    ...(type === "speech" ? { speaker: "", tailAnchor: { x: 0.5, y: 1.2 } } : {}),
  };
}
