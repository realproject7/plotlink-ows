import { speechTailPoints, validateOverlaysForExport, type TailPoints } from "@app-lib/overlays";
import { layoutBubbleText, defaultBubbleFontRange } from "@app-lib/bubble-text";
import { compressCanvasToBlob, MAX_IMAGE_BYTES } from "../lib/image-compress";

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

// Re-exported for the existing export-size validation + tests; the compression
// policy now lives in the shared image-compress module so the lettering export
// and the Codex-image import path (#301) stay in lockstep.
const MAX_SIZE = MAX_IMAGE_BYTES;

export async function ensureFontsReady(families: string[]): Promise<{ ready: boolean; missing: string[] }> {
  if (typeof document === "undefined" || !document.fonts || typeof document.fonts.load !== "function") {
    return { ready: true, missing: [] };
  }

  const missing: string[] = [];
  for (const family of families) {
    try {
      const loaded = await document.fonts.load(`16px "${family}"`);
      // load() resolves with the FontFace[] that matched. An empty array means
      // the family was never registered (e.g. CDN CSS blocked), so check() may
      // only be matching a system fallback — treat as missing.
      if (!loaded || loaded.length === 0) {
        missing.push(family);
      } else if (!document.fonts.check(`16px "${family}"`)) {
        missing.push(family);
      }
    } catch {
      missing.push(family);
    }
  }

  return { ready: missing.length === 0, missing };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

const SPEECH_FILL = "rgba(255, 255, 255, 0.9)";
const SPEECH_STROKE = "rgba(0, 0, 0, 0.3)";

// Trace a speech balloon — rounded-rect body plus its pointer tail — as ONE
// continuous outline (#317). Drawing the tail and body as separate shapes left
// the body's border stroked straight across the tail's mouth, so the export
// showed a visible seam where the two shapes met. Here the tail is instead a
// detour in the body's perimeter on whichever edge it sits, so filling and
// stroking this single path yields an integrated balloon: one fill, one outline,
// and no internal body/tail boundary line. `tail` is null for a bubble with no
// (or an inside-the-bubble) tail, which traces a plain rounded rectangle.
function traceBalloonPath(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  ow: number,
  oh: number,
  tail: TailPoints | null,
) {
  const r = Math.max(0, Math.min(8, ow / 2, oh / 2));
  const right = ox + ow;
  const bottom = oy + oh;

  // speechTailPoints places both base points exactly on one bubble edge, so the
  // edge each comparison identifies is exact (no float fuzz needed).
  const onTop = !!tail && tail.base1.y === oy && tail.base2.y === oy;
  const onRight = !!tail && tail.base1.x === right && tail.base2.x === right;
  const onBottom = !!tail && tail.base1.y === bottom && tail.base2.y === bottom;
  const onLeft = !!tail && tail.base1.x === ox && tail.base2.x === ox;

  ctx.beginPath();
  ctx.moveTo(ox + r, oy);
  // Top edge, traced left→right (base1.x < base2.x).
  if (onTop && tail) {
    ctx.lineTo(tail.base1.x, oy);
    ctx.lineTo(tail.tip.x, tail.tip.y);
    ctx.lineTo(tail.base2.x, oy);
  }
  ctx.lineTo(right - r, oy);
  ctx.arcTo(right, oy, right, oy + r, r);
  // Right edge, traced top→bottom (base1.y < base2.y).
  if (onRight && tail) {
    ctx.lineTo(right, tail.base1.y);
    ctx.lineTo(tail.tip.x, tail.tip.y);
    ctx.lineTo(right, tail.base2.y);
  }
  ctx.lineTo(right, bottom - r);
  ctx.arcTo(right, bottom, right - r, bottom, r);
  // Bottom edge, traced right→left (so base2.x first, then base1.x).
  if (onBottom && tail) {
    ctx.lineTo(tail.base2.x, bottom);
    ctx.lineTo(tail.tip.x, tail.tip.y);
    ctx.lineTo(tail.base1.x, bottom);
  }
  ctx.lineTo(ox + r, bottom);
  ctx.arcTo(ox, bottom, ox, bottom - r, r);
  // Left edge, traced bottom→top (so base2.y first, then base1.y).
  if (onLeft && tail) {
    ctx.lineTo(ox, tail.base2.y);
    ctx.lineTo(tail.tip.x, tail.tip.y);
    ctx.lineTo(ox, tail.base1.y);
  }
  ctx.lineTo(ox, oy + r);
  ctx.arcTo(ox, oy, ox + r, oy, r);
  ctx.closePath();
}

export function renderOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: Overlay[],
  width: number,
  height: number,
  bodyFont: string,
  displayFont: string,
) {
  for (const overlay of overlays) {
    const ox = overlay.x * width;
    const oy = overlay.y * height;
    const ow = overlay.width * width;
    const oh = overlay.height * height;

    if (overlay.type === "speech") {
      // Trace the body and its tail as a single outline so the exported balloon
      // has no internal seam between them (#317): one fill, one stroke, with the
      // tail forming part of the balloon's outline instead of a shape laid over
      // a fully-stroked body border.
      const tail = overlay.tailAnchor ? speechTailPoints(ox, oy, ow, oh, overlay.tailAnchor) : null;
      traceBalloonPath(ctx, ox, oy, ow, oh, tail);
      ctx.fillStyle = SPEECH_FILL;
      ctx.fill();
      ctx.strokeStyle = SPEECH_STROKE;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (overlay.type === "narration") {
      ctx.fillStyle = "rgba(240, 235, 225, 0.9)";
      ctx.fillRect(ox, oy, ow, oh);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(ox, oy, ow, oh);
    }

    const font = overlay.type === "sfx" ? displayFont : bodyFont;
    const hasSpeaker = overlay.type !== "sfx" && !!overlay.speaker;
    // Measure with the actual draw font so wrapping matches what is rendered.
    const measure = (text: string, fontSize: number): number => {
      ctx.font = `${fontSize}px ${font}`;
      return ctx.measureText(text).width;
    };
    const { minFontSize, maxFontSize } = defaultBubbleFontRange(height);
    const layout = layoutBubbleText(measure, overlay.text, ow, oh, {
      minFontSize,
      maxFontSize,
      hasSpeaker,
    });

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cx = ox + ow / 2;
    const speakerStrip = hasSpeaker ? layout.speakerFontSize * 1.2 : 0;

    // Draw the speaker label on its own strip at the top of the bubble.
    if (hasSpeaker) {
      ctx.fillStyle = "#3a3a3a";
      ctx.font = `bold ${layout.speakerFontSize}px ${font}`;
      ctx.fillText(overlay.speaker as string, cx, oy + speakerStrip / 2 + oh * 0.04, ow - 6);
    }

    // Lay out the wrapped body lines, vertically centered in the remaining box.
    const bodyTop = oy + speakerStrip;
    const bodyH = oh - speakerStrip;
    const totalTextH = layout.lines.length * layout.lineHeight;
    let lineY = bodyTop + bodyH / 2 - totalTextH / 2 + layout.lineHeight / 2;

    ctx.font = `${layout.fontSize}px ${font}`;
    for (const line of layout.lines) {
      if (overlay.type === "sfx") {
        ctx.fillStyle = "#000";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.strokeText(line, cx, lineY);
        ctx.fillText(line, cx, lineY);
      } else {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillText(line, cx, lineY);
      }
      lineY += layout.lineHeight;
    }
  }
}

interface CutTextContent {
  narration?: string;
  dialogue?: { speaker: string; text: string }[];
}

function renderCutText(
  ctx: CanvasRenderingContext2D,
  content: CutTextContent,
  width: number,
  height: number,
  font: string,
) {
  const fontSize = Math.max(14, Math.min(height * 0.05, 28));
  ctx.font = `${fontSize}px ${font}`;
  ctx.fillStyle = "#1a1a1a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines: string[] = [];
  if (content.dialogue) {
    for (const d of content.dialogue) {
      lines.push(`${d.speaker}: ${d.text}`);
    }
  }
  if (content.narration) {
    lines.push(content.narration);
  }

  const lineHeight = fontSize * 1.6;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], width / 2, startY + i * lineHeight, width - 40);
  }
}

export async function exportCut(
  cleanImageUrl: string | null,
  overlays: Overlay[],
  bodyFontFamily: string,
  displayFontFamily: string,
  cutText?: CutTextContent,
): Promise<Blob> {
  // Refuse to export an image whose overlays have invalid geometry — otherwise
  // malformed (e.g. semantic-position) overlays render nothing and we silently
  // produce an unlettered final (#309).
  const overlayCheck = validateOverlaysForExport(overlays);
  if (!overlayCheck.valid) {
    throw new Error(overlayCheck.error ?? "Overlay geometry is invalid");
  }

  let width = 800;
  let height = 600;
  let img: HTMLImageElement | null = null;

  if (cleanImageUrl) {
    img = await loadImage(cleanImageUrl);
    width = img.naturalWidth;
    height = img.naturalHeight;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  if (img) {
    ctx.drawImage(img, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }

  renderOverlays(ctx, overlays, width, height, bodyFontFamily, displayFontFamily);

  if (cutText && overlays.length === 0 && !img) {
    renderCutText(ctx, cutText, width, height, bodyFontFamily);
  }

  return compressCanvasToBlob(canvas);
}

export function validateExportSize(blob: Blob): { valid: boolean; error?: string } {
  if (blob.size > MAX_SIZE) {
    return { valid: false, error: `Image is ${(blob.size / 1024).toFixed(0)}KB, exceeds 1MB limit` };
  }
  return { valid: true };
}

export { MAX_SIZE };
