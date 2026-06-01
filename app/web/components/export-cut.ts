import { speechTailPoints } from "@app-lib/overlays";

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

const MAX_SIZE = 1024 * 1024;

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
      // Draw the tail first so the bubble body covers its base, leaving a
      // seamless join with only the two angled sides outlined — otherwise the
      // tail the writer positioned never appears in the exported image.
      const tail = overlay.tailAnchor && speechTailPoints(ox, oy, ow, oh, overlay.tailAnchor);
      if (tail) {
        ctx.fillStyle = SPEECH_FILL;
        ctx.beginPath();
        ctx.moveTo(tail.base1.x, tail.base1.y);
        ctx.lineTo(tail.tip.x, tail.tip.y);
        ctx.lineTo(tail.base2.x, tail.base2.y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = SPEECH_STROKE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tail.base1.x, tail.base1.y);
        ctx.lineTo(tail.tip.x, tail.tip.y);
        ctx.lineTo(tail.base2.x, tail.base2.y);
        ctx.stroke();
      }

      ctx.fillStyle = SPEECH_FILL;
      ctx.beginPath();
      ctx.roundRect(ox, oy, ow, oh, 8);
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
    const fontSize = Math.max(10, Math.min(oh * 0.4, 24));
    ctx.font = `${fontSize}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (overlay.type === "sfx") {
      ctx.fillStyle = "#000";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.strokeText(overlay.text, ox + ow / 2, oy + oh / 2, ow - 8);
      ctx.fillText(overlay.text, ox + ow / 2, oy + oh / 2, ow - 8);
    } else {
      ctx.fillStyle = "#1a1a1a";
      if (overlay.speaker) {
        const speakerSize = fontSize * 0.7;
        ctx.font = `bold ${speakerSize}px ${font}`;
        ctx.fillText(overlay.speaker, ox + ow / 2, oy + oh * 0.3, ow - 8);
        ctx.font = `${fontSize}px ${font}`;
        ctx.fillText(overlay.text, ox + ow / 2, oy + oh * 0.65, ow - 8);
      } else {
        ctx.fillText(overlay.text, ox + ow / 2, oy + oh / 2, ow - 8);
      }
    }
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`Failed to export as ${format}`))),
      format,
      quality,
    );
  });
}

async function tryCompress(
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  const webpQualities = [0.9, 0.8, 0.7, 0.6];
  for (const q of webpQualities) {
    try {
      const blob = await canvasToBlob(canvas, "image/webp", q);
      if (blob.type !== "image/webp") break;
      if (blob.size <= MAX_SIZE) return blob;
    } catch { break; }
  }

  const jpegQualities = [0.85, 0.7, 0.5];
  for (const q of jpegQualities) {
    const blob = await canvasToBlob(canvas, "image/jpeg", q);
    if (blob.size <= MAX_SIZE) return blob;
  }

  throw new Error("Cannot compress image under 1MB — reduce overlay count or image size");
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

  return tryCompress(canvas);
}

export function validateExportSize(blob: Blob): { valid: boolean; error?: string } {
  if (blob.size > MAX_SIZE) {
    return { valid: false, error: `Image is ${(blob.size / 1024).toFixed(0)}KB, exceeds 1MB limit` };
  }
  return { valid: true };
}

export { MAX_SIZE };
