// Shared text layout for cartoon lettering bubbles (#310).
//
// Both the export canvas (export-cut.ts) and the editor preview (LetteringEditor)
// run THIS function with a canvas `measureText`-based width measurer, so dialogue
// wraps by words and the font is sized to fit the bubble identically in the
// preview and the exported final image (WYSIWYG). Previously each drew a single
// maxWidth-compressed line, so long dialogue overflowed/clipped and the preview
// did not match the export.

export interface BubbleTextLayout {
  /** Wrapped lines of body text (never empty; [""] for empty text). */
  lines: string[];
  /** Chosen body font size in the caller's pixel space. */
  fontSize: number;
  /** Line advance (fontSize * lineHeightFactor). */
  lineHeight: number;
  /** Speaker label font size, or 0 when there is no speaker. */
  speakerFontSize: number;
  /**
   * True when the text did not fit even at the minimum font (the lines are a
   * best-effort wrap that may clip/overflow the box). Drives the editor's
   * text-overflow warning (#336). Export rendering ignores it (unchanged).
   */
  overflow: boolean;
}

export interface BubbleLayoutOptions {
  /** Largest body font to try, in the caller's pixel space. */
  maxFontSize: number;
  /** Smallest body font (used even if text still overflows). */
  minFontSize: number;
  /** Line advance as a multiple of font size. Default 1.2. */
  lineHeightFactor?: number;
  /** Horizontal padding inside the box (each side). Default 6% of width. */
  paddingX?: number;
  /** Vertical padding inside the box (each side). Default 8% of height. */
  paddingY?: number;
  /** Present a speaker label strip above the body. Default false. */
  hasSpeaker?: boolean;
}

/** Measure rendered width of `text` at `fontSize` (canvas measureText-backed). */
export type MeasureWidth = (text: string, fontSize: number) => number;

/** Greedy word-wrap of `text` to lines no wider than `maxWidth` at `fontSize`. */
export function wrapText(
  measure: MeasureWidth,
  text: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    // Keep a word on the current line if it fits, or if the line is empty (a
    // single over-long word still occupies its own line — the fit loop shrinks
    // the font until it fits the box).
    if (!current || measure(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Lay out bubble text: pick the largest font (between min and max) at which the
 * word-wrapped lines fit the box width AND total height, reserving a strip for a
 * speaker label when present. Deterministic given the same `measure`, so the
 * editor preview and the export canvas produce identical wrapping/sizing.
 */
export function layoutBubbleText(
  measure: MeasureWidth,
  text: string,
  boxWidth: number,
  boxHeight: number,
  opts: BubbleLayoutOptions,
): BubbleTextLayout {
  const lineHeightFactor = opts.lineHeightFactor ?? 1.2;
  const padX = opts.paddingX ?? Math.max(2, boxWidth * 0.06);
  const padY = opts.paddingY ?? Math.max(2, boxHeight * 0.08);
  const availW = Math.max(1, boxWidth - 2 * padX);
  const totalAvailH = Math.max(1, boxHeight - 2 * padY);

  const maxFont = Math.max(opts.minFontSize, opts.maxFontSize);
  const minFont = Math.max(1, Math.min(opts.minFontSize, maxFont));

  const fit = (bodyFont: number): { lines: string[]; ok: boolean } => {
    const speakerFont = opts.hasSpeaker ? bodyFont * 0.8 : 0;
    const speakerStrip = opts.hasSpeaker ? speakerFont * lineHeightFactor : 0;
    const bodyAvailH = Math.max(1, totalAvailH - speakerStrip);
    const lines = wrapText(measure, text, availW, bodyFont);
    const bodyH = lines.length * bodyFont * lineHeightFactor;
    const widthOk = lines.every((l) => measure(l, bodyFont) <= availW + 0.5);
    return { lines, ok: bodyH <= bodyAvailH && widthOk };
  };

  // Descend from max to min font (0.5px steps) and take the first that fits.
  for (let f = maxFont; f >= minFont; f -= 0.5) {
    const { lines, ok } = fit(f);
    if (ok) {
      return {
        lines,
        fontSize: f,
        lineHeight: f * lineHeightFactor,
        speakerFontSize: opts.hasSpeaker ? f * 0.8 : 0,
        overflow: false,
      };
    }
  }

  // Nothing fits even at min — best effort: wrap at min font (may overflow).
  const lines = wrapText(measure, text, availW, minFont);
  return {
    lines,
    fontSize: minFont,
    lineHeight: minFont * lineHeightFactor,
    speakerFontSize: opts.hasSpeaker ? minFont * 0.8 : 0,
    overflow: true,
  };
}

/**
 * Default body min/max font sizes for a bubble, as fractions of the rendering
 * HEIGHT so the export (natural image size) and the editor preview (displayed
 * size) scale together — identical wrapping at both scales. `renderHeight` is
 * the canvas/image height in the caller's pixel space.
 */
export function defaultBubbleFontRange(renderHeight: number): { minFontSize: number; maxFontSize: number } {
  return {
    minFontSize: Math.max(1, renderHeight * 0.022),
    maxFontSize: Math.max(1, renderHeight * 0.05),
  };
}
