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

// ---------------------------------------------------------------------------
// Overlay normalization / export validation (#309)
//
// Agent-authored cuts.json overlays sometimes carry a semantic `position`
// string (e.g. "upper-left") and no numeric geometry. Those records counted as
// overlays but the editor/export expect numeric x/y/width/height, so bubbles did
// not render and Export produced a silent UNLETTERED image. We normalize what we
// can (semantic position → geometry) and block export when an overlay still has
// no usable geometry.
// ---------------------------------------------------------------------------

const POSITION_MARGIN = 0.05;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Map a semantic position string ("upper-left", "top right", "bottom-center", …)
 * to a normalized top-left anchor for a box of the given width/height. Returns
 * null when no left/right/top/bottom/center keyword is recognized.
 */
export function anchorFromPosition(
  position: string,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const p = position.toLowerCase();
  const left = /\bleft\b/.test(p);
  const right = /\bright\b/.test(p);
  const top = /\b(?:top|upper)\b/.test(p);
  const bottom = /\b(?:bottom|lower)\b/.test(p);
  const center = /\b(?:center|centre|middle)\b/.test(p);
  if (!left && !right && !top && !bottom && !center) return null;
  const x = left
    ? POSITION_MARGIN
    : right
      ? clamp(1 - width - POSITION_MARGIN, 0, 1)
      : clamp((1 - width) / 2, 0, 1);
  const y = top
    ? POSITION_MARGIN
    : bottom
      ? clamp(1 - height - POSITION_MARGIN, 0, 1)
      : clamp((1 - height) / 2, 0, 1);
  return { x, y };
}

let normCounter = 0;

/**
 * Coerce a raw overlay record into a valid Overlay, or return null when it
 * cannot be placed. Accepts overlays with numeric geometry OR a recognizable
 * semantic `position`; fills a stable-ish id, default size, and (for speech) a
 * default tailAnchor. Returns null only when there is neither usable numeric
 * x/y nor a recognizable position — reported as invalid so export can block.
 */
export function normalizeOverlay(raw: unknown): Overlay | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type: OverlayType = (OVERLAY_TYPES as readonly string[]).includes(r.type as string)
    ? (r.type as OverlayType)
    : "speech";
  const text = typeof r.text === "string" ? r.text : "";

  let width = isFiniteNumber(r.width) && r.width > 0 ? r.width : type === "sfx" ? 0.15 : 0.4;
  let height = isFiniteNumber(r.height) && r.height > 0 ? r.height : type === "sfx" ? 0.08 : 0.16;

  let x: number;
  let y: number;
  if (isFiniteNumber(r.x) && isFiniteNumber(r.y)) {
    x = r.x;
    y = r.y;
  } else {
    const anchor = typeof r.position === "string" ? anchorFromPosition(r.position, width, height) : null;
    if (!anchor) return null;
    x = anchor.x;
    y = anchor.y;
  }

  x = clamp(x, 0, 1);
  y = clamp(y, 0, 1);
  width = clamp(width, 0.02, 1);
  height = clamp(height, 0.02, 1);

  const id = typeof r.id === "string" && r.id ? r.id : `overlay-norm-${++normCounter}`;
  const overlay: Overlay = { id, type, x, y, width, height, text };
  if (type === "speech") {
    overlay.speaker = typeof r.speaker === "string" ? r.speaker : "";
    const ta = r.tailAnchor as { x?: unknown; y?: unknown } | undefined;
    overlay.tailAnchor =
      ta && isFiniteNumber(ta.x) && isFiniteNumber(ta.y) ? { x: ta.x, y: ta.y } : { x: 0.5, y: 1.2 };
  } else if (typeof r.speaker === "string" && r.speaker) {
    overlay.speaker = r.speaker;
  }
  return overlay;
}

export interface NormalizeOverlaysResult {
  overlays: Overlay[];
  /** True when normalization changed the records (repaired, filled, or dropped). */
  changed: boolean;
  /** Records that could not be placed and were dropped from `overlays`. */
  invalid: { index: number; reason: string }[];
}

function isCanonicalOverlay(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    !!r.id &&
    (OVERLAY_TYPES as readonly string[]).includes(r.type as string) &&
    isFiniteNumber(r.x) &&
    isFiniteNumber(r.y) &&
    isFiniteNumber(r.width) &&
    isFiniteNumber(r.height) &&
    typeof r.text === "string"
  );
}

/** Normalize an array of raw overlay records (see normalizeOverlay). */
export function normalizeOverlays(raw: unknown): NormalizeOverlaysResult {
  const arr = Array.isArray(raw) ? raw : [];
  const overlays: Overlay[] = [];
  const invalid: { index: number; reason: string }[] = [];
  let changed = !Array.isArray(raw);
  arr.forEach((o, i) => {
    const norm = normalizeOverlay(o);
    if (!norm) {
      invalid.push({
        index: i,
        reason: "overlay has no numeric x/y/width/height and no recognizable position",
      });
      changed = true;
      return;
    }
    overlays.push(norm);
    if (!isCanonicalOverlay(o)) changed = true;
  });
  return { overlays, changed, invalid };
}

/**
 * Validate overlays immediately before export (#309). Blocks when any overlay
 * lacks finite, positive numeric geometry, so OWS never silently exports an
 * image whose overlays are invisible/unlettered. Returns the first problem.
 */
export function validateOverlaysForExport(overlays: Overlay[]): { valid: boolean; error?: string } {
  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    const geomOk =
      isFiniteNumber(o?.x) &&
      isFiniteNumber(o?.y) &&
      isFiniteNumber(o?.width) &&
      isFiniteNumber(o?.height) &&
      o.width > 0 &&
      o.height > 0;
    if (!geomOk) {
      return {
        valid: false,
        error: `Overlay ${i + 1}${o?.type ? ` (${o.type})` : ""} has invalid geometry — repair or re-place it in the lettering editor before export`,
      };
    }
  }
  return { valid: true };
}
