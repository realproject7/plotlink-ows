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
}

export function toPixel(norm: number, containerSize: number): number {
  return norm * containerSize;
}

export function toNorm(pixel: number, containerSize: number): number {
  if (containerSize === 0) return 0;
  return pixel / containerSize;
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
    ...(type === "speech" ? { speaker: "" } : {}),
  };
}
