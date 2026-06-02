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

/**
 * One drawing command in a balloon outline. `M`/`L` are move/line to (x,y); `A`
 * is a rounded corner — round the corner whose vertex is (cornerX,cornerY),
 * ending at (x,y), with radius r. The command set maps 1:1 onto both a canvas
 * path (`moveTo`/`lineTo`/`arcTo`) and an SVG path (`M`/`L`/`A`), so the editor
 * preview and the export trace the EXACT same outline (#341).
 */
export type BalloonCommand =
  | { k: "M"; x: number; y: number }
  | { k: "L"; x: number; y: number }
  | { k: "A"; cornerX: number; cornerY: number; x: number; y: number; r: number };

/**
 * The single source of truth for a speech balloon's outline (#341): the
 * rounded-rect body plus its pointer tail as ONE continuous perimeter, with the
 * tail folded into whichever edge it sits on (a detour out to the tip and back),
 * never a separate shape. Both the editor-preview SVG path (balloonPathD) and
 * the export canvas (traceBalloonPath in export-cut) are built from this list,
 * so they cannot diverge and there is no internal body/tail seam in either.
 *
 * `tail` is null for a tailless bubble (no tailAnchor, or a tip inside the
 * bubble) → a plain rounded rectangle. Coordinates are in the caller's pixel
 * space (export uses natural-image px; the preview uses display px).
 */
export function balloonOutline(
  ox: number,
  oy: number,
  ow: number,
  oh: number,
  tail: TailPoints | null,
  radius?: number,
): BalloonCommand[] {
  const r = radius ?? Math.max(0, Math.min(8, ow / 2, oh / 2));
  const right = ox + ow;
  const bottom = oy + oh;

  // speechTailPoints anchors both base points exactly on one bubble edge, so the
  // edge each comparison identifies is exact (no float fuzz needed).
  const onTop = !!tail && tail.base1.y === oy && tail.base2.y === oy;
  const onRight = !!tail && tail.base1.x === right && tail.base2.x === right;
  const onBottom = !!tail && tail.base1.y === bottom && tail.base2.y === bottom;
  const onLeft = !!tail && tail.base1.x === ox && tail.base2.x === ox;

  const cmds: BalloonCommand[] = [{ k: "M", x: ox + r, y: oy }];
  // Top edge, traced left→right (base1.x < base2.x).
  if (onTop && tail) {
    cmds.push({ k: "L", x: tail.base1.x, y: oy }, { k: "L", x: tail.tip.x, y: tail.tip.y }, { k: "L", x: tail.base2.x, y: oy });
  }
  cmds.push({ k: "L", x: right - r, y: oy }, { k: "A", cornerX: right, cornerY: oy, x: right, y: oy + r, r });
  // Right edge, traced top→bottom (base1.y < base2.y).
  if (onRight && tail) {
    cmds.push({ k: "L", x: right, y: tail.base1.y }, { k: "L", x: tail.tip.x, y: tail.tip.y }, { k: "L", x: right, y: tail.base2.y });
  }
  cmds.push({ k: "L", x: right, y: bottom - r }, { k: "A", cornerX: right, cornerY: bottom, x: right - r, y: bottom, r });
  // Bottom edge, traced right→left (so base2.x first, then base1.x).
  if (onBottom && tail) {
    cmds.push({ k: "L", x: tail.base2.x, y: bottom }, { k: "L", x: tail.tip.x, y: tail.tip.y }, { k: "L", x: tail.base1.x, y: bottom });
  }
  cmds.push({ k: "L", x: ox + r, y: bottom }, { k: "A", cornerX: ox, cornerY: bottom, x: ox, y: bottom - r, r });
  // Left edge, traced bottom→top (so base2.y first, then base1.y).
  if (onLeft && tail) {
    cmds.push({ k: "L", x: ox, y: tail.base2.y }, { k: "L", x: tail.tip.x, y: tail.tip.y }, { k: "L", x: ox, y: tail.base1.y });
  }
  cmds.push({ k: "L", x: ox, y: oy + r }, { k: "A", cornerX: ox, cornerY: oy, x: ox + r, y: oy, r });
  return cmds;
}

/**
 * SVG path `d` for a speech balloon, built from the shared {@link balloonOutline}
 * (#327, #341). Filling and stroking this single path yields an integrated
 * balloon with no internal body/tail seam; it traces the identical outline the
 * export canvas does.
 */
export function balloonPathD(
  ox: number,
  oy: number,
  ow: number,
  oh: number,
  tail: TailPoints | null,
  radius?: number,
): string {
  const parts = balloonOutline(ox, oy, ow, oh, tail, radius).map((c) =>
    c.k === "A" ? `A ${c.r} ${c.r} 0 0 1 ${c.x} ${c.y}` : `${c.k} ${c.x} ${c.y}`,
  );
  parts.push("Z");
  return parts.join(" ");
}

/**
 * Whether an overlay's BODY rect extends outside the image (#336). Coordinates
 * are normalized 0–1, so anything below 0 or past 1 on either axis is clipped at
 * export. Only the body box is checked — a speech tail intentionally points
 * beyond the bubble edge (its tip is allowed outside). A tiny epsilon avoids
 * flagging boxes that sit exactly on an edge.
 */
export function isOverlayOutOfBounds(o: Pick<Overlay, "x" | "y" | "width" | "height">): boolean {
  const eps = 1e-6;
  return (
    o.x < -eps ||
    o.y < -eps ||
    o.x + o.width > 1 + eps ||
    o.y + o.height > 1 + eps
  );
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

// ---------------------------------------------------------------------------
// Overlapping-bubble detection (#318)
//
// Pilot QA found cuts where two speech bubbles overlapped, leaving the back
// bubble's text faintly visible behind the front one — unpolished and hard to
// read. This is an MVP readability guard (not a layout engine): flag pairs of
// bubbles whose filled bodies overlap enough to occlude each other, so the
// editor can warn before export/publish. Only speech and narration bubbles have
// an opaque fill that hides what's behind them; SFX is transparent stroked text
// laid over the art, so it is not treated as occluding.
// ---------------------------------------------------------------------------

const OCCLUDING_TYPES: ReadonlySet<OverlayType> = new Set(["speech", "narration"]);

/**
 * Minimum overlap, as a fraction of the SMALLER bubble's area, for a pair to be
 * reported. A small nick where two bubbles barely touch is ignored; once an
 * eighth of the smaller bubble is covered the back text starts to be obscured.
 */
export const OVERLAP_AREA_THRESHOLD = 0.12;

export interface OverlapPair {
  /** Indexes into the overlays array (stable, 0-based). */
  indexA: number;
  indexB: number;
  idA: string;
  idB: string;
  /** Intersection area as a fraction of the smaller bubble's area (0–1). */
  ratio: number;
}

function hasFiniteRect(o: Overlay): boolean {
  return (
    isFiniteNumber(o?.x) &&
    isFiniteNumber(o?.y) &&
    isFiniteNumber(o?.width) &&
    isFiniteNumber(o?.height) &&
    o.width > 0 &&
    o.height > 0
  );
}

/**
 * Find pairs of occluding bubbles (speech/narration) that overlap by at least
 * `threshold` of the smaller bubble's area. Pure and geometry-only so it can be
 * reused by the editor warning and any pre-publish preflight. Overlays with
 * non-finite geometry are skipped (those are caught by validateOverlaysForExport).
 */
export function detectOverlappingOverlays(
  overlays: Overlay[],
  threshold: number = OVERLAP_AREA_THRESHOLD,
): OverlapPair[] {
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < overlays.length; i++) {
    const a = overlays[i];
    if (!OCCLUDING_TYPES.has(a?.type) || !hasFiniteRect(a)) continue;
    for (let j = i + 1; j < overlays.length; j++) {
      const b = overlays[j];
      if (!OCCLUDING_TYPES.has(b?.type) || !hasFiniteRect(b)) continue;
      const overlapW = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapH = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapW <= 0 || overlapH <= 0) continue;
      const intersection = overlapW * overlapH;
      const minArea = Math.min(a.width * a.height, b.width * b.height);
      const ratio = minArea > 0 ? intersection / minArea : 0;
      if (ratio >= threshold) {
        pairs.push({ indexA: i, indexB: j, idA: a.id, idB: b.id, ratio });
      }
    }
  }
  return pairs;
}
