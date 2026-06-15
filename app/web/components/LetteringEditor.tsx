import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  getDefaultFont,
  getDisplayFont,
  getFontCdnUrl,
  getFontFamily,
  type FontEntry,
} from "@app-lib/fonts";
import {
  speechTailPoints,
  balloonPathD,
  normalizeOverlays,
  detectOverlappingOverlays,
  isOverlayOutOfBounds,
  createOverlay,
  comfortableOverlaySize,
  bubbleLayoutOptionsForOverlay,
  balloonRadiusForOverlay,
  OVERLAY_TYPES,
  OVERLAY_TYPE_LABEL,
  overlayHasBubble,
  overlayRenderStyle,
  overlaySupportsTail,
  type Overlay,
  type OverlayType,
} from "@app-lib/overlays";
import { layoutBubbleText } from "@app-lib/bubble-text";
import {
  cutLetteringChecklist,
  cutScriptLines,
  isExportStale,
  overlaysSignature,
  type ScriptLine,
} from "@app-lib/lettering-status";
import { textPanelDimensions, type CutAiDraft } from "@app-lib/cuts";
import { useAuthedAsset } from "./asset-image";

function toPixel(norm: number, size: number): number {
  return norm * size;
}

function toNorm(pixel: number, size: number): number {
  if (size === 0) return 0;
  return pixel / size;
}

function loadFont(font: FontEntry) {
  const id = `gfont-${font.googleFontsId}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = getFontCdnUrl(font);
  document.head.appendChild(link);
}

interface Cut {
  id: number;
  cleanImagePath: string | null;
  overlays: Overlay[];
  narration?: string;
  sfx?: string;
  dialogue?: { speaker: string; text: string }[];
  // Export/upload status (#336) — used by the per-cut lettering checklist so the
  // writer can see how far the cut has progressed without leaving the editor.
  finalImagePath?: string | null;
  exportedAt?: string | null;
  uploadedUrl?: string | null;
  uploadedCid?: string | null;
  // Text/interstitial panel (#350/#351): no clean image — the editor uses a
  // styled background canvas and exports it as the final image.
  kind?: "image" | "text";
  background?: string;
  aspectRatio?: string;
  aiDraft?: CutAiDraft | null;
}

interface LetteringEditorProps {
  storyName: string;
  cut: Cut;
  plotFile: string;
  onSave: (
    overlays: Overlay[],
    aiDraft?: CutAiDraft | null,
  ) => void | Promise<void>;
  onClose: () => void;
  onExported?: () => void;
  language?: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  /** Focused-editor header label supplied by the review board (#488). */
  targetLabel?: string;
  /** When true, the Save button returns to the review board after persisting. */
  returnOnSave?: boolean;
  /** Whether the wider app work area / terminal is currently restored. */
  workspaceVisible?: boolean;
  /** Toggle the surrounding app work area while staying in the editor. */
  onToggleWorkspaceVisible?: () => void;
  /** Move to adjacent cuts while staying in the focused editor. */
  onPreviousCut?: () => void;
  onNextCut?: () => void;
  hasPreviousCut?: boolean;
  hasNextCut?: boolean;
}

const TYPE_BORDER: Record<OverlayType, string> = {
  speech: "border-foreground/40",
  thought: "border-muted/40",
  narration: "border-muted/40",
  system: "border-sky-400/50",
  shout: "border-foreground/60",
  shock: "border-amber-700/50",
  whisper: "border-muted/40",
  dread: "border-foreground/60",
  offscreen: "border-foreground/40",
  sfx: "border-accent/40",
  pause: "border-muted/40",
  caption: "border-muted/40",
};

const TOOL_TYPES: OverlayType[] = [
  "speech",
  "thought",
  "narration",
  "shout",
  "shock",
  "whisper",
  "sfx",
  "system",
  "caption",
];

// Short human label for a bubble in the overlap warning (#318): its speaker or
// a trimmed text snippet, falling back to the type name for empty bubbles.
function overlapLabel(o: Overlay): string {
  const snippet = (o.speaker || o.text || "").trim().replace(/\s+/g, " ");
  if (snippet)
    return `“${snippet.length > 18 ? `${snippet.slice(0, 18)}…` : snippet}”`;
  return OVERLAY_TYPE_LABEL[o.type];
}

const MIN_SIZE = 0.05;
const TAIL_PRESETS = [
  { key: "down", label: "Down", anchor: { x: 0.5, y: 1.2 } },
  { key: "up", label: "Up", anchor: { x: 0.5, y: -0.2 } },
  { key: "left", label: "Left", anchor: { x: -0.2, y: 0.5 } },
  { key: "right", label: "Right", anchor: { x: 1.2, y: 0.5 } },
] as const;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function LetteringEditor({
  storyName,
  cut,
  plotFile,
  onSave,
  onClose,
  onExported,
  language = "English",
  authFetch,
  targetLabel,
  returnOnSave = false,
  workspaceVisible = false,
  onToggleWorkspaceVisible,
  onPreviousCut,
  onNextCut,
  hasPreviousCut = false,
  hasNextCut = false,
}: LetteringEditorProps) {
  const bodyFont = getDefaultFont(language);
  const displayFont = getDisplayFont();
  const bodyFontFamily = getFontFamily(bodyFont);
  const displayFontFamily = getFontFamily(displayFont);

  useEffect(() => {
    loadFont(bodyFont);
    loadFont(displayFont);
  }, [bodyFont, displayFont]);

  // Wait for the same fonts export waits on, then allow the exact preview layout
  // to compute/recompute with the loaded font metrics (#310, re1).
  useEffect(() => {
    let cancelled = false;
    setFontsReady(false);
    (async () => {
      try {
        const { ensureFontsReady } = await import("./export-cut");
        await ensureFontsReady([bodyFont.family, displayFont.family]);
      } catch {
        /* best effort — still render the preview */
      }
      if (!cancelled) setFontsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [bodyFont.family, displayFont.family]);

  // Clean image lives behind requireAuth, so a raw <img src> would 401. Load it
  // via authFetch into a blob object URL and reuse that same URL for export.
  const cleanAsset = useAuthedAsset(storyName, cut.cleanImagePath, authFetch);
  // Repair agent-authored overlays (e.g. semantic `position` strings with no
  // numeric geometry) on load so the bubbles actually render and export — and
  // surface a note when some could not be auto-placed (#309).
  const overlayNormalization = useMemo(
    () => normalizeOverlays(cut.overlays),
    [cut.overlays],
  );
  const invalidOverlayCount = overlayNormalization.invalid.length;
  // Overlays that could not be placed (no geometry, no recognizable position)
  // are NOT exported. Exporting silently would produce a final missing that
  // bubble/text, so block export until the writer explicitly discards them (#309).
  const [acknowledgedInvalid, setAcknowledgedInvalid] = useState(false);
  const autoPlacedOverlays =
    invalidOverlayCount === 0 &&
    overlayNormalization.changed &&
    overlayNormalization.overlays.length > 0;
  const [overlays, setOverlays] = useState<Overlay[]>(
    () => overlayNormalization.overlays as Overlay[],
  );
  // Signature of the overlays that match the current export/upload (#336, re1).
  // Captured (already normalized like the live `overlays`) when the cut opens so
  // a load-time normalization isn't mistaken for a user edit, and advanced to the
  // live overlays after a successful re-export so the stale flag clears without
  // closing the editor. As state, so updating it recomputes staleExport.
  const [exportBaselineSig, setExportBaselineSig] = useState(() =>
    overlaysSignature(overlayNormalization.overlays as Overlay[]),
  );
  // Offscreen canvas to measure text exactly like the export canvas, so the
  // preview wraps/sizes bubble text identically to the final image (#310).
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const measureWidth = useCallback(
    (fontFamily: string) =>
      (text: string, fontSize: number, fontWeight: 400 | 700 = 400): number => {
        if (!measureCanvasRef.current && typeof document !== "undefined") {
          measureCanvasRef.current = document.createElement("canvas");
        }
        const mctx = measureCanvasRef.current?.getContext("2d");
        if (!mctx) return text.length * fontSize * 0.5; // jsdom fallback
        mctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        return mctx.measureText(text).width;
      },
    [],
  );
  // Gate the exact (canvas-measured) preview layout on the SAME font-readiness
  // signal export uses (ensureFontsReady), so the preview does not freeze line
  // breaks computed from fallback-font metrics that would diverge from the
  // exported image (#310, re1). Recomputes once the web fonts are loaded.
  const [fontsReady, setFontsReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [imageBounds, setImageBounds] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  useEffect(() => {
    const nextOverlays = overlayNormalization.overlays as Overlay[];
    setOverlays(nextOverlays);
    setSelectedId(null);
    setAcknowledgedInvalid(false);
    setConfirmDelete(false);
    setExportError(null);
    setSaveError(null);
    setExportBaselineSig(overlaysSignature(nextOverlays));
  }, [cut.id, overlayNormalization]);

  const updateImageBounds = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    let iw: number;
    let ih: number;
    if (cut.kind === "text") {
      // A text panel has no image — size the editor canvas from the SAME aspect
      // ratio the export uses, so lettering and the exported final agree (#351).
      const dims = textPanelDimensions(cut.aspectRatio) ?? {
        width: 800,
        height: 600,
      };
      iw = dims.width;
      ih = dims.height;
    } else {
      const img = imgRef.current;
      if (!img || !img.naturalWidth) return;
      iw = img.naturalWidth;
      ih = img.naturalHeight;
    }
    if (!cw || !ch) return;
    const scale = Math.min(cw / iw, ch / ih);
    const rw = iw * scale;
    const rh = ih * scale;
    setImageBounds({
      x: (cw - rw) / 2,
      y: (ch - rh) / 2,
      width: rw,
      height: rh,
    });
  }, [cut.kind, cut.aspectRatio]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => updateImageBounds());
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateImageBounds]);

  // Size an overlay so ordinary narration/dialogue lines don't overflow the box
  // the instant they're added (#452). With the loaded fonts + image metrics it
  // grows the height (at a comfortable on-image width) until the text fits at the
  // default font; without measurement it falls back to a generous default that
  // fits ordinary lines, instead of the tiny create-default. The writer can still
  // resize freely afterward, and the overflow warning stays useful if they shrink it.
  const fittedSize = useCallback(
    (o: Overlay): { width: number; height: number } => {
      const comfortable = comfortableOverlaySize(o.type, o.x, o.y);
      const width = comfortable.width;
      const maxH = Math.max(0.08, 1 - o.y);
      if (!o.text || !fontsReady || imageBounds.width <= 0) {
        return comfortable;
      }
      const fontFamily = o.type === "sfx" ? displayFontFamily : bodyFontFamily;
      const wPx = toPixel(width, imageBounds.width);
      let height = o.type === "sfx" ? 0.08 : 0.12;
      for (let i = 0; i < 24; i++) {
        const h = Math.min(height, maxH);
        const hPx = toPixel(h, imageBounds.height);
        const layout = layoutBubbleText(
          measureWidth(fontFamily),
          o.text,
          wPx,
          hPx,
          bubbleLayoutOptionsForOverlay(
            { ...o, width, height: h },
            imageBounds.height || 300,
            wPx,
            hPx,
          ),
        );
        if (!layout.overflow || h >= maxH) return { width, height: h };
        height += 0.03;
      }
      return { width, height: Math.min(height, maxH) };
    },
    [fontsReady, imageBounds, measureWidth, bodyFontFamily, displayFontFamily],
  );

  const addOverlay = useCallback(
    (type: OverlayType) => {
      const o = createOverlay(
        type,
        0.1 + Math.random() * 0.3,
        0.1 + Math.random() * 0.3,
      );
      const sized: Overlay = { ...o, ...fittedSize(o) };
      setOverlays((prev) => [...prev, sized]);
      setSelectedId(sized.id);
    },
    [fittedSize],
  );

  // Insert a line from the cut's cuts.json script (#336) as a prefilled overlay,
  // so the writer never has to hand-copy dialogue/narration/SFX out of the JSON.
  const addScriptLine = useCallback(
    (line: ScriptLine) => {
      const o = createOverlay(
        line.type,
        0.1 + Math.random() * 0.3,
        0.1 + Math.random() * 0.3,
      );
      const filled: Overlay = {
        ...o,
        text: line.text,
        ...(line.type === "speech" && line.speaker
          ? { speaker: line.speaker }
          : {}),
      };
      const sized: Overlay = { ...filled, ...fittedSize(filled) };
      setOverlays((prev) => [...prev, sized]);
      setSelectedId(sized.id);
    },
    [fittedSize],
  );

  const updateOverlay = useCallback((id: string, changes: Partial<Overlay>) => {
    setOverlays((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ...changes } : o)),
    );
  }, []);

  const enableManualTypography = useCallback(
    (overlay: Overlay) => {
      const renderHeight = imageBounds.height || 300;
      const width =
        imageBounds.width > 0 ? toPixel(overlay.width, imageBounds.width) : 200;
      const height =
        imageBounds.height > 0
          ? toPixel(overlay.height, imageBounds.height)
          : 100;
      const fontFamily =
        overlay.type === "sfx" ? displayFontFamily : bodyFontFamily;
      const autoLayout = layoutBubbleText(
        measureWidth(fontFamily),
        overlay.text,
        width,
        height,
        bubbleLayoutOptionsForOverlay(
          { ...overlay, textStyle: undefined },
          renderHeight,
          width,
          height,
        ),
      );
      updateOverlay(overlay.id, {
        textStyle: {
          mode: "manual",
          fontScale: autoLayout.fontSize / Math.max(1, renderHeight),
          fontWeight: overlay.textStyle?.fontWeight ?? 400,
          lineHeightFactor:
            autoLayout.fontSize > 0
              ? autoLayout.lineHeight / autoLayout.fontSize
              : 1.2,
          speakerScale:
            autoLayout.fontSize > 0 && autoLayout.speakerFontSize > 0
              ? autoLayout.speakerFontSize / autoLayout.fontSize
              : 0.8,
        },
      });
    },
    [
      imageBounds,
      displayFontFamily,
      bodyFontFamily,
      measureWidth,
      updateOverlay,
    ],
  );

  const deleteOverlay = useCallback((id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    setSelectedId(null);
    setConfirmDelete(false);
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedId(null);
    setConfirmDelete(false);
  }, []);

  const handleOverlayClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedId(id);
    setConfirmDelete(false);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, id: string, mode: "move" | "resize") => {
      e.stopPropagation();
      e.preventDefault();
      const overlay = overlays.find((o) => o.id === id);
      if (!overlay) return;
      setSelectedId(id);
      dragRef.current = {
        id,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        origX: overlay.x,
        origY: overlay.y,
        origW: overlay.width,
        origH: overlay.height,
      };
    },
    [overlays],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || imageBounds.width === 0) return;
      const dx = toNorm(e.clientX - drag.startX, imageBounds.width);
      const dy = toNorm(e.clientY - drag.startY, imageBounds.height);

      if (drag.mode === "move") {
        const newX = clamp(drag.origX + dx, 0, 1 - drag.origW);
        const newY = clamp(drag.origY + dy, 0, 1 - drag.origH);
        updateOverlay(drag.id, { x: newX, y: newY });
      } else {
        const newW = clamp(drag.origW + dx, MIN_SIZE, 1 - drag.origX);
        const newH = clamp(drag.origH + dy, MIN_SIZE, 1 - drag.origY);
        updateOverlay(drag.id, { width: newW, height: newH });
      }
    };

    const onMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [imageBounds, updateOverlay]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    try {
      const currentSig = overlaysSignature(overlays);
      const nextAiDraft =
        cut.aiDraft?.status === "generated" &&
        currentSig !== (cut.aiDraft.baseSig ?? "")
          ? {
              ...cut.aiDraft,
              status: "edited" as const,
              updatedAt: new Date().toISOString(),
            }
          : (cut.aiDraft ?? undefined);
      await onSave(overlays, nextAiDraft ?? null);
      if (returnOnSave) onClose();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save overlays",
      );
    }
  }, [overlays, onSave, onClose, returnOnSave, cut.aiDraft]);

  const handleExport = useCallback(async () => {
    // Block export when the cut plan contained overlays that could not be placed
    // (no numeric geometry, no recognizable position). Dropping them silently
    // would export an image missing the intended bubble/text (#309, re1).
    // Require an explicit discard first — do not save or export the reduced set.
    if (invalidOverlayCount > 0 && !acknowledgedInvalid) {
      const c = invalidOverlayCount;
      setExportError(
        `${c} overlay${c === 1 ? "" : "s"} from the cut plan ${c === 1 ? "has" : "have"} no usable position and cannot be exported — re-place ${c === 1 ? "it" : "them"} or discard ${c === 1 ? "it" : "them"} first.`,
      );
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      await onSave(overlays);

      const { exportCut, ensureFontsReady } = await import("./export-cut");

      const usesSfx = overlays.some((o) => o.type === "sfx");
      const fontsToCheck = [
        bodyFont.family,
        ...(usesSfx ? [displayFont.family] : []),
      ];
      const { ready, missing } = await ensureFontsReady(fontsToCheck);
      if (!ready) {
        setExportError(
          `Fonts not loaded: ${missing.join(", ")}. Check your connection and retry.`,
        );
        setExporting(false);
        return;
      }

      // Export the actual loaded clean image, never a blank canvas standing in
      // for an image that simply failed to load.
      if (cut.cleanImagePath && !cleanAsset.url) {
        setExportError(
          cleanAsset.error
            ? "Clean image failed to load — cannot export. Retry once it renders."
            : "Clean image still loading — wait for it to render, then export.",
        );
        setExporting(false);
        return;
      }
      const imgUrl = cleanAsset.url;
      const blob = await exportCut(
        imgUrl,
        overlays,
        bodyFontFamily,
        displayFontFamily,
        { narration: cut.narration, dialogue: cut.dialogue },
        // Text panels have no clean image — render the final on a styled
        // background canvas sized by the panel's aspect ratio (#351).
        cut.kind === "text"
          ? { background: cut.background, aspectRatio: cut.aspectRatio }
          : undefined,
      );

      const fd = new FormData();
      const ext = blob.type === "image/webp" ? "webp" : "jpg";
      fd.append("file", blob, `cut-${cut.id}.${ext}`);

      const res = await authFetch(
        `/api/stories/${storyName}/cuts/${plotFile}/export-final/${cut.id}`,
        { method: "POST", body: fd },
      );
      if (!res.ok) {
        const data = await res.json();
        setExportError(data.error || "Export failed");
      } else {
        // The just-exported overlays are now the export baseline, so the stale
        // warning/checklist clear immediately without closing the editor (re1).
        setExportBaselineSig(overlaysSignature(overlays));
        onExported?.();
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [
    cut,
    cleanAsset,
    overlays,
    storyName,
    plotFile,
    bodyFont,
    displayFont,
    bodyFontFamily,
    displayFontFamily,
    authFetch,
    onSave,
    onExported,
    invalidOverlayCount,
    acknowledgedInvalid,
  ]);

  const selectedOverlay = overlays.find((o) => o.id === selectedId);

  // Flag bubbles whose filled bodies overlap enough to hide each other's text so
  // the writer gets a readability warning before export/publish (#318). Computed
  // from the live overlay positions, so it clears as soon as bubbles are moved
  // apart. Non-blocking: overlap can be intentional, so it never blocks export.
  const overlapPairs = useMemo(
    () => detectOverlappingOverlays(overlays),
    [overlays],
  );

  // Re-baseline when a different cut opens without a remount (rare — the parent
  // normally unmounts the editor between cuts).
  const baselineCutIdRef = useRef(cut.id);
  useEffect(() => {
    if (baselineCutIdRef.current !== cut.id) {
      baselineCutIdRef.current = cut.id;
      setExportBaselineSig(
        overlaysSignature(overlayNormalization.overlays as Overlay[]),
      );
    }
  }, [cut.id, overlayNormalization.overlays]);

  // The recorded export/upload is stale once the writer edits bubbles since it
  // was produced — the final image/uploaded URL no longer match the screen, so
  // export & upload must be redone before they count again (#336, re1).
  const staleExport = isExportStale({
    exported: !!cut.finalImagePath || !!cut.exportedAt,
    uploaded: !!cut.uploadedUrl || !!cut.uploadedCid,
    baselineSig: exportBaselineSig,
    current: overlays,
  });

  // Per-cut lettering checklist + insertable script lines (#336). The checklist
  // shows progress (clean image → script text → bubbles placed → exported →
  // uploaded) right in the editor; the script lines power one-click insertion.
  // A stale export marks the exported/uploaded steps incomplete until re-export.
  const checklist = useMemo(
    () => cutLetteringChecklist({ ...cut, overlays }, { staleExport }),
    [cut, overlays, staleExport],
  );
  const scriptLines = useMemo(() => cutScriptLines(cut), [cut]);

  // Likely export problems per overlay (#336): the body rect clipped by the
  // image bounds, or text that overflows even at the smallest font. Out-of-bounds
  // is pure geometry; overflow needs the loaded-font metrics, so it only computes
  // once fonts are ready (same gate as the exact preview layout).
  const overlayWarnings = useMemo(() => {
    const out: Record<string, { outOfBounds: boolean; overflow: boolean }> = {};
    for (const o of overlays) {
      const outOfBounds = isOverlayOutOfBounds(o);
      let overflow = false;
      if (fontsReady && imageBounds.width > 0 && o.text) {
        const fontFamily =
          o.type === "sfx" ? displayFontFamily : bodyFontFamily;
        const w = toPixel(o.width, imageBounds.width);
        const h = toPixel(o.height, imageBounds.height);
        const layout = layoutBubbleText(
          measureWidth(fontFamily),
          o.text,
          w,
          h,
          bubbleLayoutOptionsForOverlay(o, imageBounds.height || 300, w, h),
        );
        overflow = layout.overflow;
      }
      if (outOfBounds || overflow) out[o.id] = { outOfBounds, overflow };
    }
    return out;
  }, [
    overlays,
    fontsReady,
    imageBounds,
    measureWidth,
    bodyFontFamily,
    displayFontFamily,
  ]);
  const warningCount = Object.keys(overlayWarnings).length;
  const checklistChips: Array<{
    key: string;
    label: string;
    done: boolean;
  }> = [
    { key: "clean-image", label: "Clean", done: checklist.hasCleanImage },
    { key: "script-text", label: "Script", done: checklist.hasScriptText },
    {
      key: "bubbles",
      label: checklist.bubblesPlaced
        ? `Bubbles ${checklist.bubblesPlaced}`
        : "Bubbles",
      done: checklist.bubblesPlaced > 0,
    },
    { key: "exported", label: "Exported", done: checklist.exported },
    { key: "uploaded", label: "Uploaded", done: checklist.uploaded },
  ];

  const isTextPanel = cut.kind === "text";
  const isNarrationCut = !cut.cleanImagePath;

  // A text/interstitial panel (#351) is editable on a styled background canvas
  // even when empty, so it skips the "no clean image" guard that applies to a
  // would-be image cut with nothing placed yet.
  if (
    !isTextPanel &&
    isNarrationCut &&
    overlays.length === 0 &&
    !cut.narration &&
    !cut.dialogue?.length
  ) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted">
        No clean image — upload one first, or add overlays for a narration cut.
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col"
      data-testid="focused-lettering-editor"
    >
      {/* Toolbar */}
      <div
        className="px-2 py-1 border-b border-border bg-surface/55 grid grid-cols-[minmax(12rem,1fr)_auto_minmax(10rem,1fr)] items-center gap-2"
        data-testid="lettering-toolbar"
      >
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-[10px] border border-border rounded text-muted hover:text-foreground"
            data-testid="return-to-cut-review-btn"
          >
            Cut review
          </button>
          <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-accent whitespace-nowrap">
            Lettering
          </span>
          <span className="text-[11px] font-mono text-muted">
            {targetLabel ?? `Cut #${cut.id}`}
          </span>
          <span
            className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted"
            data-testid="overlay-count"
          >
            {overlays.length} overlays
          </span>
          {checklistChips.map((chip) => (
            <span
              key={chip.key}
              data-testid={`lettering-check-${chip.key}`}
              data-done={chip.done ? "true" : "false"}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                chip.key === "exported" || chip.key === "uploaded" || chip.key === "script-text"
                  ? "hidden 2xl:inline-flex"
                  : ""
              } ${
                chip.done
                  ? "border-green-700/30 bg-green-700/10 text-green-700"
                  : "border-border bg-background text-muted"
              }`}
            >
              {chip.done ? "✓ " : "○ "}
              {chip.label}
            </span>
          ))}
          <span className="sr-only">Focused lettering editor</span>
          {cut.aiDraft?.status === "generated" && (
            <span
              className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent"
              data-testid="ai-draft-current-target"
            >
              AI draft ready
            </span>
          )}
        </div>
        <div className="flex items-center justify-center gap-0.5 rounded border border-border bg-background px-1 py-0.5" data-testid="lettering-tool-strip">
          {TOOL_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => addOverlay(type)}
              className="px-1.5 py-0.5 text-[10px] rounded hover:bg-accent/10 hover:text-accent"
              data-testid={`add-${type}`}
              title={`Add ${OVERLAY_TYPE_LABEL[type]} overlay`}
            >
              {OVERLAY_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 justify-end min-w-0">
          {onToggleWorkspaceVisible && (
            <button
              onClick={onToggleWorkspaceVisible}
              className="px-2 py-0.5 text-[10px] border border-border rounded text-muted hover:border-accent hover:text-accent"
              data-testid="toggle-work-area-btn"
            >
              {workspaceVisible ? "Hide work area" : "Show work area"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowHelp((prev) => !prev)}
            className="px-2 py-0.5 text-[10px] border border-border rounded text-muted hover:border-accent hover:text-accent"
            data-testid="lettering-help-toggle"
          >
            {showHelp ? "Hide help" : "Help"}
          </button>
          {exportError && (
            <span className="text-[10px] text-error max-w-[18rem]">
              {exportError}
            </span>
          )}
          {saveError && (
            <span className="text-[10px] text-error max-w-[18rem]">
              {saveError}
            </span>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-2 py-0.5 text-[10px] border border-accent text-accent rounded hover:bg-accent/5 disabled:opacity-50"
            data-testid="export-btn"
          >
            {exporting ? "Exporting..." : "Export"}
          </button>
          <button
            onClick={() => {
              void handleSave();
            }}
            className="px-2 py-0.5 text-[10px] bg-accent text-white rounded hover:bg-accent-dim"
            data-testid="save-lettering-btn"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-[10px] text-muted hover:text-foreground border border-border rounded"
            data-testid="cancel-lettering-btn"
          >
            Cancel
          </button>
        </div>
      </div>

      {showHelp && (
        <div
          className="px-3 py-1.5 border-b border-border bg-background text-[10px] text-muted"
          data-testid="lettering-help-panel"
        >
          Add or select a bubble, edit it in the inspector, then Save to return
          to cut review. Use Export after the overlay layout is ready. Text cards
          use narration overlays on the canvas.
        </div>
      )}

      {invalidOverlayCount > 0 && !acknowledgedInvalid ? (
        <div
          className="px-3 py-1 border-b border-border bg-error/10 text-[10px] text-error flex items-center gap-2 flex-wrap"
          data-testid="overlay-repair-note"
        >
          <span>
            {invalidOverlayCount} overlay{invalidOverlayCount === 1 ? "" : "s"}{" "}
            from the cut plan {invalidOverlayCount === 1 ? "has" : "have"} no
            usable position and cannot be exported. Re-place{" "}
            {invalidOverlayCount === 1 ? "it" : "them"}, or
          </span>
          <button
            onClick={() => setAcknowledgedInvalid(true)}
            data-testid="discard-invalid-overlays"
            className="px-1.5 py-0.5 border border-error/40 rounded hover:bg-error/10"
          >
            discard {invalidOverlayCount} unplaceable overlay
            {invalidOverlayCount === 1 ? "" : "s"}
          </button>
        </div>
      ) : invalidOverlayCount > 0 ? (
        <div
          className="px-3 py-1 border-b border-border bg-amber-500/10 text-[10px] text-amber-700"
          data-testid="overlay-repair-note"
        >
          Discarded {invalidOverlayCount} unplaceable overlay
          {invalidOverlayCount === 1 ? "" : "s"} — the export will not include{" "}
          {invalidOverlayCount === 1 ? "it" : "them"}.
        </div>
      ) : autoPlacedOverlays ? (
        <div
          className="px-3 py-1 border-b border-border bg-amber-500/10 text-[10px] text-amber-700"
          data-testid="overlay-repair-note"
        >
          Auto-placed overlays from the cut plan — review their positions before
          exporting.
        </div>
      ) : null}

      {overlapPairs.length > 0 && (
        <div
          className="px-3 py-1 border-b border-border bg-amber-500/10 text-[10px] text-amber-700"
          data-testid="overlay-overlap-warning"
        >
          Cut #{cut.id}: {overlapPairs.length} bubble{" "}
          {overlapPairs.length === 1 ? "pair overlaps" : "pairs overlap"} and
          may be hard to read —{" "}
          {overlapPairs
            .map(
              (p) =>
                `#${p.indexA + 1} ${overlapLabel(overlays[p.indexA])} ↔ #${p.indexB + 1} ${overlapLabel(overlays[p.indexB])}`,
            )
            .join("; ")}
          . Move them apart, or export as-is if the overlap is intended.
        </div>
      )}

      {/* Stale-export warning (#336, re1): bubbles changed since the recorded
          export/upload, so the final image/uploaded URL are out of date. The
          compact toolbar chips already mark export/upload incomplete; this says why. */}
      {staleExport && (
        <div
          className="px-3 py-1 border-b border-border bg-amber-500/10 text-[10px] text-amber-700"
          data-testid="lettering-stale-export-warning"
        >
          Bubbles changed since the last export — re-export this cut and upload
          the new final image before publishing.
        </div>
      )}

      {/* Likely export problems (#336): clipped/out-of-bounds bubbles or text that
          overflows even at the smallest font. Non-blocking guidance. */}
      {warningCount > 0 && (
        <div
          className="px-3 py-1 border-b border-border bg-amber-500/10 text-[10px] text-amber-700"
          data-testid="lettering-export-warning"
        >
          {warningCount} bubble{warningCount === 1 ? "" : "s"} may not export
          cleanly:{" "}
          {Object.entries(overlayWarnings)
            .map(([id, w]) => {
              const idx = overlays.findIndex((o) => o.id === id);
              const problems = [
                w.outOfBounds ? "outside image" : null,
                w.overflow ? "text overflow" : null,
              ]
                .filter(Boolean)
                .join(", ");
              return `#${idx + 1} ${overlapLabel(overlays[idx])} (${problems})`;
            })
            .join("; ")}
          . Resize or reposition before exporting.
        </div>
      )}

      {/* Editor surface */}
      <div className="flex-1 min-h-0 flex">
        <div
          ref={containerRef}
          className="flex-1 min-w-0 relative overflow-hidden bg-[#f8f5ef]"
          onClick={handleBackgroundClick}
          data-testid="editor-surface"
        >
          {cut.cleanImagePath && cleanAsset.error ? (
            <div
              className="w-full h-full flex items-center justify-center text-muted text-xs"
              data-testid="clean-image-error"
            >
              Clean image not available
            </div>
          ) : cut.cleanImagePath && !cleanAsset.url ? (
            <div
              className="w-full h-full flex items-center justify-center text-muted text-xs"
              data-testid="clean-image-loading"
            >
              Loading clean image…
            </div>
          ) : cut.cleanImagePath ? (
            <img
              ref={imgRef}
              src={cleanAsset.url!}
              alt={`Cut ${cut.id} clean`}
              className="w-full h-full object-contain"
              draggable={false}
              onLoad={updateImageBounds}
            />
          ) : isTextPanel ? (
            // Text panel: an aspect-ratio-contained canvas (imageBounds), so the
            // lettering surface matches the exported final's shape (#351, re1).
            imageBounds.width > 0 && (
              <div
                className="absolute flex items-center justify-center text-muted text-xs"
                style={{
                  left: imageBounds.x,
                  top: imageBounds.y,
                  width: imageBounds.width,
                  height: imageBounds.height,
                  background: cut.background || "#ffffff",
                }}
                data-testid="text-panel-canvas"
              >
                Text panel
              </div>
            )
          ) : (
            <div
              className="w-full h-full bg-white flex items-center justify-center text-muted text-xs"
              ref={(el) => {
                if (el && imageBounds.width === 0) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width > 0) {
                    setImageBounds({
                      x: 0,
                      y: 0,
                      width: rect.width,
                      height: rect.height,
                    });
                  }
                }
              }}
            >
              Narration cut
            </div>
          )}

          {(onPreviousCut || onNextCut) && (
            <>
              <button
                type="button"
                onClick={onPreviousCut}
                disabled={!hasPreviousCut}
                className="absolute left-3 top-1/2 z-20 flex h-12 w-8 -translate-y-1/2 items-center justify-center rounded border border-border bg-background/85 text-2xl text-accent shadow-sm hover:bg-background disabled:opacity-30 disabled:hover:bg-background/85"
                data-testid="previous-cut-btn"
                aria-label="Previous cut"
              >
                <span aria-hidden>‹</span>
                <span className="sr-only">Previous cut</span>
              </button>
              <button
                type="button"
                onClick={onNextCut}
                disabled={!hasNextCut}
                className="absolute right-3 top-1/2 z-20 flex h-12 w-8 -translate-y-1/2 items-center justify-center rounded border border-border bg-background/85 text-2xl text-accent shadow-sm hover:bg-background disabled:opacity-30 disabled:hover:bg-background/85"
                data-testid="next-cut-btn"
                aria-label="Next cut"
              >
                <span aria-hidden>›</span>
                <span className="sr-only">Next cut</span>
              </button>
            </>
          )}

          {/* Speech balloons, drawn under the overlay boxes (which carry the
              text + drag/resize handles) so the box sits on top of the fill.
              Body + tail are ONE integrated <path> per bubble (#327), mirroring
              the export's traceBalloonPath (#317): one fill, one stroke, so the
              tail reads as part of the balloon outline with no internal seam.
              Tailless speech (no tailAnchor, or a tip inside the bubble) traces
              a plain rounded rectangle. Tail-anchor edits update the path live. */}
          {imageBounds.width > 0 && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              data-testid="balloon-layer"
            >
              {overlays.map((overlay) => {
                if (!overlayHasBubble(overlay.type)) return null;
                const ox =
                  imageBounds.x + toPixel(overlay.x, imageBounds.width);
                const oy =
                  imageBounds.y + toPixel(overlay.y, imageBounds.height);
                const ow = toPixel(overlay.width, imageBounds.width);
                const oh = toPixel(overlay.height, imageBounds.height);
                const radius = balloonRadiusForOverlay(overlay, ow, oh);
                const tail =
                  overlaySupportsTail(overlay.type) && overlay.tailAnchor
                    ? speechTailPoints(ox, oy, ow, oh, overlay.tailAnchor, radius)
                    : null;
                // Strong, clean near-black outline scaled to the preview size so
                // the bubble reads as a webtoon balloon (matching the export's
                // proportional stroke), not a faint UI box (#363).
                const strokeW = Math.max(1.5, imageBounds.height * 0.004);
                const selected = overlay.id === selectedId;
                const style = overlayRenderStyle(overlay);
                return (
                  <path
                    key={overlay.id}
                    data-testid={`balloon-${overlay.id}`}
                    d={balloonPathD(ox, oy, ow, oh, tail, radius)}
                    fill={style.fill}
                    fillOpacity={style.fillOpacity}
                    stroke={selected ? "var(--accent)" : style.stroke}
                    strokeOpacity={selected ? 1 : style.strokeOpacity}
                    strokeWidth={selected ? strokeW + 0.6 : Math.max(1.25, strokeW * style.strokeScale)}
                    strokeLinejoin="round"
                  />
                );
              })}
            </svg>
          )}

          {imageBounds.width > 0 &&
            overlays.map((overlay) => {
              const left =
                imageBounds.x + toPixel(overlay.x, imageBounds.width);
              const top =
                imageBounds.y + toPixel(overlay.y, imageBounds.height);
              const width = toPixel(overlay.width, imageBounds.width);
              const height = toPixel(overlay.height, imageBounds.height);
              const isSelected = overlay.id === selectedId;
              // Speech bubbles draw no body border here — the integrated balloon
              // <path> in the layer below is their outline, so a box border would
              // re-introduce the body/tail seam (#327). Their selection cue is the
              // path's accent stroke (plus the resize handle). Narration/SFX keep
              // their bordered box + selection ring as before.
              const hasBubble = overlayHasBubble(overlay.type);
              const style = overlayRenderStyle(overlay);
              const warned = !!overlayWarnings[overlay.id];

              return (
                <div
                  key={overlay.id}
                  data-testid={`overlay-${overlay.id}`}
                  data-warning={warned ? "true" : "false"}
                  onClick={(e) => handleOverlayClick(e, overlay.id)}
                  onMouseDown={(e) => handleMouseDown(e, overlay.id, "move")}
                  className={`absolute rounded cursor-move select-none ${
                    hasBubble ? "" : `border-2 ${TYPE_BORDER[overlay.type]}`
                  } ${
                    isSelected && !hasBubble ? "ring-2 ring-accent" : ""
                  } ${warned ? "ring-2 ring-amber-500" : ""}`}
                  style={{ left, top, width, height }}
                >
                  {(() => {
                    const fontFamily =
                      overlay.type === "sfx"
                        ? displayFontFamily
                        : bodyFontFamily;
                    if (!overlay.text) {
                      return (
                        <span
                          className="text-[9px] px-1 text-muted truncate block pointer-events-none"
                          style={{ fontFamily }}
                        >
                          {OVERLAY_TYPE_LABEL[overlay.type]}
                        </span>
                      );
                    }
                    const hasSpeaker =
                      overlay.type !== "sfx" && !!overlay.speaker;
                    if (!fontsReady) {
                      // Until the web font's metrics are available, don't freeze
                      // canvas-measured line breaks from fallback metrics (they
                      // would diverge from export). Show a CSS-wrapped transient;
                      // the exact layout computes once fonts are ready (#310, re1).
                      return (
                        <div
                          className="absolute inset-0 flex items-center justify-center px-1 overflow-hidden pointer-events-none text-center break-words"
                          style={{
                            fontFamily,
                            fontSize: Math.max(9, Math.min(height * 0.05, 16)),
                            fontWeight: overlay.textStyle?.fontWeight ?? 400,
                            color: style.text,
                          }}
                          data-testid={`overlay-text-${overlay.id}`}
                          data-fonts-ready="false"
                        >
                          {hasSpeaker
                            ? `${overlay.speaker}: ${overlay.text}`
                            : overlay.text}
                        </div>
                      );
                    }
                    const layout = layoutBubbleText(
                      measureWidth(fontFamily),
                      overlay.text,
                      width,
                      height,
                      bubbleLayoutOptionsForOverlay(
                        overlay,
                        imageBounds.height,
                        width,
                        height,
                      ),
                    );
                    return (
                      <div
                        className="absolute inset-0 flex flex-col items-center justify-center px-1 overflow-hidden pointer-events-none text-center"
                        style={{ fontFamily }}
                        data-testid={`overlay-text-${overlay.id}`}
                        data-fonts-ready="true"
                      >
                        {hasSpeaker && (
                          <span
                            className="font-bold text-[#3a3a3a] block"
                            style={{
                              fontSize: layout.speakerFontSize,
                              lineHeight: 1.2,
                              color: style.speaker,
                            }}
                          >
                            {overlay.speaker}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: layout.fontSize,
                            lineHeight: `${layout.lineHeight}px`,
                            fontWeight: overlay.textStyle?.fontWeight ?? 400,
                            color: style.text,
                          }}
                        >
                          {layout.lines.map((line, i) => (
                            <span key={i} className="block">
                              {line}
                            </span>
                          ))}
                        </span>
                      </div>
                    );
                  })()}
                  {isSelected && (
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        handleMouseDown(e, overlay.id, "resize");
                      }}
                      className="absolute bottom-0 right-0 w-2 h-2 bg-accent cursor-se-resize"
                      data-testid={`resize-${overlay.id}`}
                    />
                  )}
                </div>
              );
            })}
        </div>

        {/* Inspector panel */}
        <div className="w-64 border-l border-border p-3 overflow-y-auto flex-shrink-0">
          {selectedOverlay ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">
                  {OVERLAY_TYPE_LABEL[selectedOverlay.type]}
                </p>
                <span className="text-[10px] text-muted">
                  #{overlays.findIndex((o) => o.id === selectedOverlay.id) + 1}
                </span>
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] font-medium text-muted">
                  Bubble kind
                </span>
                <select
                  value={selectedOverlay.type}
                  onChange={(e) => {
                    const nextType = e.target.value as OverlayType;
                    updateOverlay(selectedOverlay.id, {
                      type: nextType,
                      kind: nextType,
                      ...(overlaySupportsTail(nextType)
                        ? {
                            speaker: selectedOverlay.speaker ?? "",
                            tailAnchor:
                              selectedOverlay.tailAnchor ??
                              (nextType === "offscreen"
                                ? { x: 1.2, y: 0.5 }
                                : { x: 0.5, y: 1.2 }),
                          }
                        : { tailAnchor: undefined }),
                    });
                  }}
                  className="w-full px-2 py-1 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                  data-testid="inspector-overlay-type"
                >
                  {OVERLAY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {OVERLAY_TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </label>

              {selectedOverlay.speaker !== undefined && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium text-muted">
                    Speaker
                  </span>
                  <input
                    value={selectedOverlay.speaker || ""}
                    onChange={(e) =>
                      updateOverlay(selectedOverlay.id, {
                        speaker: e.target.value,
                      })
                    }
                    className="w-full px-2 py-1 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                    placeholder="Character name"
                    data-testid="inspector-speaker"
                  />
                </label>
              )}

              <label className="block space-y-1">
                <span className="text-[10px] font-medium text-muted">Text</span>
                <textarea
                  value={selectedOverlay.text}
                  onChange={(e) =>
                    updateOverlay(selectedOverlay.id, { text: e.target.value })
                  }
                  rows={3}
                  className="w-full px-2 py-1 text-xs border border-border rounded bg-transparent resize-none focus:border-accent focus:outline-none"
                  placeholder="Overlay text"
                  data-testid="inspector-text"
                />
              </label>

              {/* One-click resize so a long line that overflows can be fitted
                  without hand-dragging the box (#452). */}
              <button
                onClick={() =>
                  updateOverlay(selectedOverlay.id, fittedSize(selectedOverlay))
                }
                data-testid="inspector-fit-text"
                className="w-full px-2 py-1 text-[11px] border border-border rounded hover:border-accent hover:text-accent"
                title="Resize this overlay so its text fits without overflowing"
              >
                Fit box to text
              </button>

              <div
                className="space-y-1.5 rounded border border-border/70 p-2"
                data-testid="inspector-typography"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-muted">
                    Typography
                  </span>
                  {selectedOverlay.textStyle?.mode === "manual" ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateOverlay(selectedOverlay.id, {
                          textStyle: undefined,
                        })
                      }
                      className="px-1.5 py-0.5 text-[10px] border border-border rounded hover:border-accent hover:bg-accent/5"
                      data-testid="inspector-text-auto"
                    >
                      Auto-fit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => enableManualTypography(selectedOverlay)}
                      className="px-1.5 py-0.5 text-[10px] border border-border rounded hover:border-accent hover:bg-accent/5"
                      data-testid="inspector-text-manual"
                    >
                      Manual
                    </button>
                  )}
                </div>
                {selectedOverlay.textStyle?.mode === "manual" ? (
                  <div className="space-y-1.5">
                    <label className="block space-y-1">
                      <span className="text-[10px] text-muted">
                        Font size (% panel height)
                      </span>
                      <input
                        type="number"
                        step="0.1"
                        min="1.5"
                        max="12"
                        value={(
                          (selectedOverlay.textStyle.fontScale ?? 0.032) * 100
                        ).toFixed(1)}
                        onChange={(e) =>
                          updateOverlay(selectedOverlay.id, {
                            textStyle: {
                              ...selectedOverlay.textStyle,
                              mode: "manual",
                              fontScale: Math.max(
                                0.015,
                                Math.min(
                                  0.12,
                                  (parseFloat(e.target.value) || 3.2) / 100,
                                ),
                              ),
                            },
                          })
                        }
                        className="w-full px-2 py-1 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                        data-testid="inspector-font-scale"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] text-muted">Weight</span>
                      <select
                        value={String(
                          selectedOverlay.textStyle.fontWeight ?? 400,
                        )}
                        onChange={(e) =>
                          updateOverlay(selectedOverlay.id, {
                            textStyle: {
                              ...selectedOverlay.textStyle,
                              mode: "manual",
                              fontWeight: e.target.value === "700" ? 700 : 400,
                            },
                          })
                        }
                        className="w-full px-2 py-1 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                        data-testid="inspector-font-weight"
                      >
                        <option value="400">Regular</option>
                        <option value="700">Bold</option>
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] text-muted">
                        Line height
                      </span>
                      <input
                        type="number"
                        step="0.05"
                        min="0.9"
                        max="2"
                        value={(
                          selectedOverlay.textStyle.lineHeightFactor ?? 1.2
                        ).toFixed(2)}
                        onChange={(e) =>
                          updateOverlay(selectedOverlay.id, {
                            textStyle: {
                              ...selectedOverlay.textStyle,
                              mode: "manual",
                              lineHeightFactor: Math.max(
                                0.9,
                                Math.min(2, parseFloat(e.target.value) || 1.2),
                              ),
                            },
                          })
                        }
                        className="w-full px-2 py-1 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                        data-testid="inspector-line-height"
                      />
                    </label>
                    {selectedOverlay.type !== "sfx" && (
                      <label className="block space-y-1">
                        <span className="text-[10px] text-muted">
                          Speaker scale
                        </span>
                        <input
                          type="number"
                          step="0.05"
                          min="0.5"
                          max="1.5"
                          value={(
                            selectedOverlay.textStyle.speakerScale ?? 0.8
                          ).toFixed(2)}
                          onChange={(e) =>
                            updateOverlay(selectedOverlay.id, {
                              textStyle: {
                                ...selectedOverlay.textStyle,
                                mode: "manual",
                                speakerScale: Math.max(
                                  0.5,
                                  Math.min(
                                    1.5,
                                    parseFloat(e.target.value) || 0.8,
                                  ),
                                ),
                              },
                            })
                          }
                          className="w-full px-2 py-1 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                          data-testid="inspector-speaker-scale"
                        />
                      </label>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted">
                    Auto-fit stays on by default and resizes text to the box.
                  </p>
                )}
              </div>

              {overlaySupportsTail(selectedOverlay.type) &&
                (() => {
                  const tail = selectedOverlay.tailAnchor || { x: 0.5, y: 1.2 };
                  return (
                    <div className="space-y-1">
                      <span className="text-[10px] font-medium text-muted">
                        Tail anchor
                      </span>
                      <div
                        className="flex flex-wrap gap-1"
                        data-testid="inspector-tail-presets"
                      >
                        {TAIL_PRESETS.map((preset) => (
                          <button
                            key={preset.key}
                            type="button"
                            onClick={() =>
                              updateOverlay(selectedOverlay.id, {
                                tailAnchor: preset.anchor,
                              })
                            }
                            className="px-1.5 py-0.5 text-[10px] border border-border rounded hover:border-accent hover:bg-accent/5"
                            data-testid={`inspector-tail-${preset.key}`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <label className="flex items-center gap-1 text-[10px] font-mono text-muted">
                          x
                          <input
                            type="number"
                            step="0.1"
                            value={tail.x}
                            onChange={(e) =>
                              updateOverlay(selectedOverlay.id, {
                                tailAnchor: {
                                  ...tail,
                                  x: parseFloat(e.target.value) || 0,
                                },
                              })
                            }
                            className="w-14 px-1 py-0.5 text-[10px] border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                            data-testid="inspector-tail-x"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-[10px] font-mono text-muted">
                          y
                          <input
                            type="number"
                            step="0.1"
                            value={tail.y}
                            onChange={(e) =>
                              updateOverlay(selectedOverlay.id, {
                                tailAnchor: {
                                  ...tail,
                                  y: parseFloat(e.target.value) || 0,
                                },
                              })
                            }
                            className="w-14 px-1 py-0.5 text-[10px] border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                            data-testid="inspector-tail-y"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })()}

              {selectedOverlay.type !== "sfx" && (
                <div
                  className="space-y-1.5 rounded border border-border/70 p-2"
                  data-testid="inspector-bubble-style"
                >
                  <span className="text-[10px] font-medium text-muted">
                    Bubble controls
                  </span>
                  <label className="block space-y-1">
                    <span className="text-[10px] text-muted">
                      Bubble color
                    </span>
                    <input
                      type="color"
                      value={selectedOverlay.bubbleColor ?? selectedOverlay.bubbleStyle?.bubbleColor ?? "#ffffff"}
                      onChange={(e) =>
                        updateOverlay(selectedOverlay.id, {
                          bubbleColor: e.target.value,
                        })
                      }
                      className="h-7 w-full border border-border rounded bg-transparent"
                      data-testid="inspector-bubble-color"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] text-muted">
                      Text color
                    </span>
                    <input
                      type="color"
                      value={selectedOverlay.textColor ?? selectedOverlay.bubbleStyle?.textColor ?? "#1a1a1a"}
                      onChange={(e) =>
                        updateOverlay(selectedOverlay.id, {
                          textColor: e.target.value,
                        })
                      }
                      className="h-7 w-full border border-border rounded bg-transparent"
                      data-testid="inspector-text-color"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] text-muted">
                      Opacity
                    </span>
                    <input
                      type="range"
                      min="0.25"
                      max="1"
                      step="0.05"
                      value={selectedOverlay.opacity ?? selectedOverlay.bubbleStyle?.opacity ?? 0.95}
                      onChange={(e) =>
                        updateOverlay(selectedOverlay.id, {
                          opacity: Math.max(0.25, Math.min(1, parseFloat(e.target.value) || 0.95)),
                        })
                      }
                      className="w-full"
                      data-testid="inspector-opacity"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] text-muted">
                      Padding X (% width)
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="25"
                      value={(
                        (selectedOverlay.bubbleStyle?.paddingX ?? 0.06) * 100
                      ).toFixed(0)}
                      onChange={(e) =>
                        updateOverlay(selectedOverlay.id, {
                          bubbleStyle: {
                            ...selectedOverlay.bubbleStyle,
                            paddingX: Math.max(
                              0,
                              Math.min(
                                0.25,
                                (parseFloat(e.target.value) || 6) / 100,
                              ),
                            ),
                          },
                        })
                      }
                      className="w-full px-2 py-1 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                      data-testid="inspector-padding-x"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] text-muted">
                      Padding Y (% height)
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="25"
                      value={(
                        (selectedOverlay.bubbleStyle?.paddingY ?? 0.08) * 100
                      ).toFixed(0)}
                      onChange={(e) =>
                        updateOverlay(selectedOverlay.id, {
                          bubbleStyle: {
                            ...selectedOverlay.bubbleStyle,
                            paddingY: Math.max(
                              0,
                              Math.min(
                                0.25,
                                (parseFloat(e.target.value) || 8) / 100,
                              ),
                            ),
                          },
                        })
                      }
                      className="w-full px-2 py-1 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                      data-testid="inspector-padding-y"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] text-muted">
                      Corner roundness (% short side)
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="49"
                      value={(
                        (selectedOverlay.bubbleStyle?.cornerRadius ?? 0.4) * 100
                      ).toFixed(0)}
                      onChange={(e) =>
                        updateOverlay(selectedOverlay.id, {
                          bubbleStyle: {
                            ...selectedOverlay.bubbleStyle,
                            cornerRadius: Math.max(
                              0,
                              Math.min(
                                0.49,
                                (parseFloat(e.target.value) || 40) / 100,
                              ),
                            ),
                          },
                        })
                      }
                      className="w-full px-2 py-1 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                      data-testid="inspector-corner-radius"
                    />
                  </label>
                </div>
              )}

              <div
                className="text-[10px] text-muted"
                data-testid="inspector-font"
              >
                Font:{" "}
                {selectedOverlay.type === "sfx"
                  ? displayFont.family
                  : bodyFont.family}
              </div>

              <div className="text-[10px] font-mono text-muted space-y-0.5">
                <p>
                  x: {selectedOverlay.x.toFixed(3)}, y:{" "}
                  {selectedOverlay.y.toFixed(3)}
                </p>
                <p>
                  w: {selectedOverlay.width.toFixed(3)}, h:{" "}
                  {selectedOverlay.height.toFixed(3)}
                </p>
              </div>

              <button
                onClick={() => {
                  if (confirmDelete) deleteOverlay(selectedOverlay.id);
                  else setConfirmDelete(true);
                }}
                className="w-full px-2 py-1 text-xs text-error border border-error/30 rounded hover:bg-error/5"
                data-testid="delete-overlay"
              >
                {confirmDelete ? "Click again to delete" : "Delete"}
              </button>

              {scriptLines.length > 0 && (
                <div
                  className="space-y-1.5 border-t border-border pt-3"
                  data-testid="script-insert-panel"
                >
                  <span className="text-[10px] font-medium text-muted">
                    Add from script
                  </span>
                  <div className="flex flex-col gap-1">
                    {scriptLines.map((line) => (
                      <button
                        key={line.key}
                        onClick={() => addScriptLine(line)}
                        data-testid={`script-insert-${line.key}`}
                        title={`Add ${line.type} overlay with this text`}
                        className="text-left px-2 py-1 text-[10px] border border-border rounded hover:border-accent hover:bg-accent/5"
                      >
                        <span className="font-medium text-accent">
                          + {OVERLAY_TYPE_LABEL[line.type]}
                        </span>{" "}
                        <span className="text-muted">
                          {line.speaker ? `${line.speaker}: ` : ""}
                          {line.text.length > 32
                            ? `${line.text.slice(0, 32)}…`
                            : line.text}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted" data-testid="inspector-empty">
                Select or add an overlay to inspect it.
              </p>
              {cut.aiDraft?.status === "generated" && (
                <div className="rounded border border-accent/30 bg-accent/5 p-2 text-[10px] text-muted">
                  AI drafted overlays are editable here before export.
                </div>
              )}
              {/* Insert-from-script (#336): drop the cut's planned dialogue/narration/
                  SFX straight into a prefilled overlay — no copy/paste out of JSON. */}
              {scriptLines.length > 0 && (
                <div className="space-y-1.5" data-testid="script-insert-panel">
                  <span className="text-[10px] font-medium text-muted">
                    Add from script
                  </span>
                  <div className="flex flex-col gap-1">
                    {scriptLines.map((line) => (
                      <button
                        key={line.key}
                        onClick={() => addScriptLine(line)}
                        data-testid={`script-insert-${line.key}`}
                        title={`Add ${line.type} overlay with this text`}
                        className="text-left px-2 py-1 text-[10px] border border-border rounded hover:border-accent hover:bg-accent/5"
                      >
                        <span className="font-medium text-accent">
                          + {OVERLAY_TYPE_LABEL[line.type]}
                        </span>{" "}
                        <span className="text-muted">
                          {line.speaker ? `${line.speaker}: ` : ""}
                          {line.text.length > 32
                            ? `${line.text.slice(0, 32)}…`
                            : line.text}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
