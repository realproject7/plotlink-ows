import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  getDefaultFont,
  getDisplayFont,
  getFontCdnUrl,
  getFontFamily,
  type FontEntry,
} from "@app-lib/fonts";
import { speechTailPoints, balloonPathD, normalizeOverlays, detectOverlappingOverlays, isOverlayOutOfBounds } from "@app-lib/overlays";
import { layoutBubbleText, defaultBubbleFontRange } from "@app-lib/bubble-text";
import { cutLetteringChecklist, cutScriptLines, isExportStale, overlaysSignature, type ScriptLine } from "@app-lib/lettering-status";
import { textPanelDimensions } from "@app-lib/cuts";
import { useAuthedAsset } from "./asset-image";

type OverlayType = "speech" | "narration" | "sfx";

interface Overlay {
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

function toPixel(norm: number, size: number): number {
  return norm * size;
}

function toNorm(pixel: number, size: number): number {
  if (size === 0) return 0;
  return pixel / size;
}

let counter = 0;
function createOverlay(type: OverlayType, x = 0.1, y = 0.1): Overlay {
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
}

interface LetteringEditorProps {
  storyName: string;
  cut: Cut;
  plotFile: string;
  onSave: (overlays: Overlay[]) => void | Promise<void>;
  onClose: () => void;
  onExported?: () => void;
  language?: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
}

const TYPE_LABEL: Record<OverlayType, string> = {
  speech: "Speech",
  narration: "Narration",
  sfx: "SFX",
};

const TYPE_BORDER: Record<OverlayType, string> = {
  speech: "border-foreground/40",
  narration: "border-muted/40",
  sfx: "border-accent/40",
};

// Short human label for a bubble in the overlap warning (#318): its speaker or
// a trimmed text snippet, falling back to the type name for empty bubbles.
function overlapLabel(o: Overlay): string {
  const snippet = (o.speaker || o.text || "").trim().replace(/\s+/g, " ");
  if (snippet) return `“${snippet.length > 18 ? `${snippet.slice(0, 18)}…` : snippet}”`;
  return TYPE_LABEL[o.type];
}

const MIN_SIZE = 0.05;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function LetteringEditor({ storyName, cut, plotFile, onSave, onClose, onExported, language = "English", authFetch }: LetteringEditorProps) {
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
      } catch { /* best effort — still render the preview */ }
      if (!cancelled) setFontsReady(true);
    })();
    return () => { cancelled = true; };
  }, [bodyFont.family, displayFont.family]);

  // Clean image lives behind requireAuth, so a raw <img src> would 401. Load it
  // via authFetch into a blob object URL and reuse that same URL for export.
  const cleanAsset = useAuthedAsset(storyName, cut.cleanImagePath, authFetch);
  // Repair agent-authored overlays (e.g. semantic `position` strings with no
  // numeric geometry) on load so the bubbles actually render and export — and
  // surface a note when some could not be auto-placed (#309).
  const overlayNormalization = useMemo(() => normalizeOverlays(cut.overlays), [cut.overlays]);
  const invalidOverlayCount = overlayNormalization.invalid.length;
  // Overlays that could not be placed (no geometry, no recognizable position)
  // are NOT exported. Exporting silently would produce a final missing that
  // bubble/text, so block export until the writer explicitly discards them (#309).
  const [acknowledgedInvalid, setAcknowledgedInvalid] = useState(false);
  const autoPlacedOverlays =
    invalidOverlayCount === 0 && overlayNormalization.changed && overlayNormalization.overlays.length > 0;
  const [overlays, setOverlays] = useState<Overlay[]>(() => overlayNormalization.overlays as Overlay[]);
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
  const measureWidth = useCallback((fontFamily: string) => (text: string, fontSize: number): number => {
    if (!measureCanvasRef.current && typeof document !== "undefined") {
      measureCanvasRef.current = document.createElement("canvas");
    }
    const mctx = measureCanvasRef.current?.getContext("2d");
    if (!mctx) return text.length * fontSize * 0.5; // jsdom fallback
    mctx.font = `${fontSize}px ${fontFamily}`;
    return mctx.measureText(text).width;
  }, []);
  // Gate the exact (canvas-measured) preview layout on the SAME font-readiness
  // signal export uses (ensureFontsReady), so the preview does not freeze line
  // breaks computed from fallback-font metrics that would diverge from the
  // exported image (#310, re1). Recomputes once the web fonts are loaded.
  const [fontsReady, setFontsReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [imageBounds, setImageBounds] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ id: string; mode: "move" | "resize"; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);

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
      const dims = textPanelDimensions(cut.aspectRatio) ?? { width: 800, height: 600 };
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
    setImageBounds({ x: (cw - rw) / 2, y: (ch - rh) / 2, width: rw, height: rh });
  }, [cut.kind, cut.aspectRatio]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => updateImageBounds());
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateImageBounds]);

  const addOverlay = useCallback((type: OverlayType) => {
    const o = createOverlay(type, 0.1 + Math.random() * 0.3, 0.1 + Math.random() * 0.3);
    setOverlays((prev) => [...prev, o]);
    setSelectedId(o.id);
  }, []);

  // Insert a line from the cut's cuts.json script (#336) as a prefilled overlay,
  // so the writer never has to hand-copy dialogue/narration/SFX out of the JSON.
  const addScriptLine = useCallback((line: ScriptLine) => {
    const o = createOverlay(line.type, 0.1 + Math.random() * 0.3, 0.1 + Math.random() * 0.3);
    const filled: Overlay = {
      ...o,
      text: line.text,
      ...(line.type === "speech" && line.speaker ? { speaker: line.speaker } : {}),
    };
    setOverlays((prev) => [...prev, filled]);
    setSelectedId(filled.id);
  }, []);

  const updateOverlay = useCallback((id: string, changes: Partial<Overlay>) => {
    setOverlays((prev) => prev.map((o) => o.id === id ? { ...o, ...changes } : o));
  }, []);

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

  const handleMouseDown = useCallback((e: React.MouseEvent, id: string, mode: "move" | "resize") => {
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
  }, [overlays]);

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

    const onMouseUp = () => { dragRef.current = null; };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [imageBounds, updateOverlay]);

  const handleSave = useCallback(() => {
    onSave(overlays);
  }, [overlays, onSave]);

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
      const fontsToCheck = [bodyFont.family, ...(usesSfx ? [displayFont.family] : [])];
      const { ready, missing } = await ensureFontsReady(fontsToCheck);
      if (!ready) {
        setExportError(`Fonts not loaded: ${missing.join(", ")}. Check your connection and retry.`);
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
        cut.kind === "text" ? { background: cut.background, aspectRatio: cut.aspectRatio } : undefined,
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
  }, [cut, cleanAsset, overlays, storyName, plotFile, bodyFont, displayFont, bodyFontFamily, displayFontFamily, authFetch, onSave, onExported, invalidOverlayCount, acknowledgedInvalid]);

  const selectedOverlay = overlays.find((o) => o.id === selectedId);

  // Flag bubbles whose filled bodies overlap enough to hide each other's text so
  // the writer gets a readability warning before export/publish (#318). Computed
  // from the live overlay positions, so it clears as soon as bubbles are moved
  // apart. Non-blocking: overlap can be intentional, so it never blocks export.
  const overlapPairs = useMemo(() => detectOverlappingOverlays(overlays), [overlays]);

  // Re-baseline when a different cut opens without a remount (rare — the parent
  // normally unmounts the editor between cuts).
  const baselineCutIdRef = useRef(cut.id);
  useEffect(() => {
    if (baselineCutIdRef.current !== cut.id) {
      baselineCutIdRef.current = cut.id;
      setExportBaselineSig(overlaysSignature(overlayNormalization.overlays as Overlay[]));
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
    const { minFontSize, maxFontSize } = defaultBubbleFontRange(imageBounds.height || 300);
    for (const o of overlays) {
      const outOfBounds = isOverlayOutOfBounds(o);
      let overflow = false;
      if (fontsReady && imageBounds.width > 0 && o.text) {
        const fontFamily = o.type === "sfx" ? displayFontFamily : bodyFontFamily;
        const w = toPixel(o.width, imageBounds.width);
        const h = toPixel(o.height, imageBounds.height);
        const layout = layoutBubbleText(measureWidth(fontFamily), o.text, w, h, {
          minFontSize,
          maxFontSize,
          hasSpeaker: o.type !== "sfx" && !!o.speaker,
        });
        overflow = layout.overflow;
      }
      if (outOfBounds || overflow) out[o.id] = { outOfBounds, overflow };
    }
    return out;
  }, [overlays, fontsReady, imageBounds, measureWidth, bodyFontFamily, displayFontFamily]);
  const warningCount = Object.keys(overlayWarnings).length;

  const isTextPanel = cut.kind === "text";
  const isNarrationCut = !cut.cleanImagePath;

  // A text/interstitial panel (#351) is editable on a styled background canvas
  // even when empty, so it skips the "no clean image" guard that applies to a
  // would-be image cut with nothing placed yet.
  if (!isTextPanel && isNarrationCut && overlays.length === 0 && !cut.narration && !cut.dialogue?.length) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted">
        No clean image — upload one first, or add overlays for a narration cut.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted">Cut #{cut.id}</span>
          <span className="text-[10px] text-muted" data-testid="overlay-count">{overlays.length} overlays</span>
          <div className="flex items-center gap-1 ml-2">
            <button onClick={() => addOverlay("speech")} className="px-2 py-0.5 text-[10px] border border-border rounded hover:border-accent hover:bg-accent/5" data-testid="add-speech">Speech</button>
            <button onClick={() => addOverlay("narration")} className="px-2 py-0.5 text-[10px] border border-border rounded hover:border-accent hover:bg-accent/5" data-testid="add-narration">Narration</button>
            <button onClick={() => addOverlay("sfx")} className="px-2 py-0.5 text-[10px] border border-border rounded hover:border-accent hover:bg-accent/5" data-testid="add-sfx">SFX</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {exportError && <span className="text-[10px] text-error">{exportError}</span>}
          <button onClick={handleExport} disabled={exporting} className="px-3 py-1 text-xs border border-accent text-accent rounded hover:bg-accent/5 disabled:opacity-50" data-testid="export-btn">
            {exporting ? "Exporting..." : "Export"}
          </button>
          <button onClick={handleSave} className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-dim">Save</button>
          <button onClick={onClose} className="px-3 py-1 text-xs text-muted hover:text-foreground border border-border rounded">Close</button>
        </div>
      </div>

      {invalidOverlayCount > 0 && !acknowledgedInvalid ? (
        <div className="px-3 py-1 border-b border-border bg-error/10 text-[10px] text-error flex items-center gap-2 flex-wrap" data-testid="overlay-repair-note">
          <span>
            {invalidOverlayCount} overlay{invalidOverlayCount === 1 ? "" : "s"} from the cut plan {invalidOverlayCount === 1 ? "has" : "have"} no usable position and cannot be exported. Re-place {invalidOverlayCount === 1 ? "it" : "them"}, or
          </span>
          <button
            onClick={() => setAcknowledgedInvalid(true)}
            data-testid="discard-invalid-overlays"
            className="px-1.5 py-0.5 border border-error/40 rounded hover:bg-error/10"
          >
            discard {invalidOverlayCount} unplaceable overlay{invalidOverlayCount === 1 ? "" : "s"}
          </button>
        </div>
      ) : invalidOverlayCount > 0 ? (
        <div className="px-3 py-1 border-b border-border bg-amber-500/10 text-[10px] text-amber-700" data-testid="overlay-repair-note">
          Discarded {invalidOverlayCount} unplaceable overlay{invalidOverlayCount === 1 ? "" : "s"} — the export will not include {invalidOverlayCount === 1 ? "it" : "them"}.
        </div>
      ) : autoPlacedOverlays ? (
        <div className="px-3 py-1 border-b border-border bg-amber-500/10 text-[10px] text-amber-700" data-testid="overlay-repair-note">
          Auto-placed overlays from the cut plan — review their positions before exporting.
        </div>
      ) : null}

      {overlapPairs.length > 0 && (
        <div
          className="px-3 py-1 border-b border-border bg-amber-500/10 text-[10px] text-amber-700"
          data-testid="overlay-overlap-warning"
        >
          Cut #{cut.id}: {overlapPairs.length} bubble {overlapPairs.length === 1 ? "pair overlaps" : "pairs overlap"} and may be hard to read —{" "}
          {overlapPairs
            .map((p) => `#${p.indexA + 1} ${overlapLabel(overlays[p.indexA])} ↔ #${p.indexB + 1} ${overlapLabel(overlays[p.indexB])}`)
            .join("; ")}
          . Move them apart, or export as-is if the overlap is intended.
        </div>
      )}

      {/* Per-cut lettering checklist (#336): shows how far this cut has come so
          the writer can finish it from the editor without inspecting cuts.json. */}
      <div
        className="px-3 py-1 border-b border-border flex items-center gap-3 flex-wrap text-[10px] text-muted"
        data-testid="lettering-checklist"
      >
        {([
          ["clean-image", "Clean image", checklist.hasCleanImage],
          ["script-text", "Script text", checklist.hasScriptText],
          ["bubbles", `Bubbles placed${checklist.bubblesPlaced ? ` (${checklist.bubblesPlaced})` : ""}`, checklist.bubblesPlaced > 0],
          ["exported", "Final exported", checklist.exported],
          ["uploaded", "Uploaded", checklist.uploaded],
        ] as [string, string, boolean][]).map(([key, label, done]) => (
          <span
            key={key}
            data-testid={`lettering-check-${key}`}
            data-done={done ? "true" : "false"}
            className={`flex items-center gap-1 ${done ? "text-green-700" : "text-muted/70"}`}
          >
            <span aria-hidden>{done ? "✓" : "○"}</span>
            {label}
          </span>
        ))}
      </div>

      {/* Stale-export warning (#336, re1): bubbles changed since the recorded
          export/upload, so the final image/uploaded URL are out of date. The
          checklist already marks export/upload incomplete; this says why. */}
      {staleExport && (
        <div
          className="px-3 py-1 border-b border-border bg-amber-500/10 text-[10px] text-amber-700"
          data-testid="lettering-stale-export-warning"
        >
          Bubbles changed since the last export — re-export this cut and upload the new final image before publishing.
        </div>
      )}

      {/* Likely export problems (#336): clipped/out-of-bounds bubbles or text that
          overflows even at the smallest font. Non-blocking guidance. */}
      {warningCount > 0 && (
        <div
          className="px-3 py-1 border-b border-border bg-amber-500/10 text-[10px] text-amber-700"
          data-testid="lettering-export-warning"
        >
          {warningCount} bubble{warningCount === 1 ? "" : "s"} may not export cleanly:{" "}
          {Object.entries(overlayWarnings)
            .map(([id, w]) => {
              const idx = overlays.findIndex((o) => o.id === id);
              const problems = [w.outOfBounds ? "outside image" : null, w.overflow ? "text overflow" : null]
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
          className="flex-1 min-w-0 relative overflow-hidden"
          onClick={handleBackgroundClick}
          data-testid="editor-surface"
        >
          {cut.cleanImagePath && cleanAsset.error ? (
            <div className="w-full h-full flex items-center justify-center text-muted text-xs" data-testid="clean-image-error">
              Clean image not available
            </div>
          ) : cut.cleanImagePath && !cleanAsset.url ? (
            <div className="w-full h-full flex items-center justify-center text-muted text-xs" data-testid="clean-image-loading">
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
                    setImageBounds({ x: 0, y: 0, width: rect.width, height: rect.height });
                  }
                }
              }}
            >
              Narration cut
            </div>
          )}

          {/* Speech balloons, drawn under the overlay boxes (which carry the
              text + drag/resize handles) so the box sits on top of the fill.
              Body + tail are ONE integrated <path> per bubble (#327), mirroring
              the export's traceBalloonPath (#317): one fill, one stroke, so the
              tail reads as part of the balloon outline with no internal seam.
              Tailless speech (no tailAnchor, or a tip inside the bubble) traces
              a plain rounded rectangle. Tail-anchor edits update the path live. */}
          {imageBounds.width > 0 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none" data-testid="balloon-layer">
              {overlays.map((overlay) => {
                if (overlay.type !== "speech") return null;
                const ox = imageBounds.x + toPixel(overlay.x, imageBounds.width);
                const oy = imageBounds.y + toPixel(overlay.y, imageBounds.height);
                const ow = toPixel(overlay.width, imageBounds.width);
                const oh = toPixel(overlay.height, imageBounds.height);
                const tail = overlay.tailAnchor ? speechTailPoints(ox, oy, ow, oh, overlay.tailAnchor) : null;
                // Strong, clean near-black outline scaled to the preview size so
                // the bubble reads as a webtoon balloon (matching the export's
                // proportional stroke), not a faint UI box (#363).
                const strokeW = Math.max(1.5, imageBounds.height * 0.004);
                const selected = overlay.id === selectedId;
                return (
                  <path
                    key={overlay.id}
                    data-testid={`balloon-${overlay.id}`}
                    d={balloonPathD(ox, oy, ow, oh, tail)}
                    className={`fill-white/95 ${selected ? "stroke-accent" : "stroke-[#1a1a1a]"}`}
                    strokeWidth={selected ? strokeW + 0.5 : strokeW}
                    strokeLinejoin="round"
                  />
                );
              })}
            </svg>
          )}

          {imageBounds.width > 0 && overlays.map((overlay) => {
            const left = imageBounds.x + toPixel(overlay.x, imageBounds.width);
            const top = imageBounds.y + toPixel(overlay.y, imageBounds.height);
            const width = toPixel(overlay.width, imageBounds.width);
            const height = toPixel(overlay.height, imageBounds.height);
            const isSelected = overlay.id === selectedId;
            // Speech bubbles draw no body border here — the integrated balloon
            // <path> in the layer below is their outline, so a box border would
            // re-introduce the body/tail seam (#327). Their selection cue is the
            // path's accent stroke (plus the resize handle). Narration/SFX keep
            // their bordered box + selection ring as before.
            const isSpeech = overlay.type === "speech";
            // Narration reads as an intentional parchment caption card (rounded,
            // filled), mirroring the export, instead of an empty bordered box (#363).
            const isNarration = overlay.type === "narration";
            const warned = !!overlayWarnings[overlay.id];

            return (
              <div
                key={overlay.id}
                data-testid={`overlay-${overlay.id}`}
                data-warning={warned ? "true" : "false"}
                onClick={(e) => handleOverlayClick(e, overlay.id)}
                onMouseDown={(e) => handleMouseDown(e, overlay.id, "move")}
                className={`absolute rounded cursor-move select-none ${
                  isSpeech ? "" : `border-2 ${TYPE_BORDER[overlay.type]}`
                } ${isNarration ? "bg-[#f4efe6]/85 rounded-md" : ""} ${
                  isSelected && !isSpeech ? "ring-2 ring-accent" : ""
                } ${warned ? "ring-2 ring-amber-500" : ""}`}
                style={{ left, top, width, height }}
              >
                {(() => {
                  const fontFamily = overlay.type === "sfx" ? displayFontFamily : bodyFontFamily;
                  if (!overlay.text) {
                    return (
                      <span className="text-[9px] px-1 text-muted truncate block pointer-events-none" style={{ fontFamily }}>
                        {TYPE_LABEL[overlay.type]}
                      </span>
                    );
                  }
                  const hasSpeaker = overlay.type !== "sfx" && !!overlay.speaker;
                  if (!fontsReady) {
                    // Until the web font's metrics are available, don't freeze
                    // canvas-measured line breaks from fallback metrics (they
                    // would diverge from export). Show a CSS-wrapped transient;
                    // the exact layout computes once fonts are ready (#310, re1).
                    return (
                      <div
                        className="absolute inset-0 flex items-center justify-center px-1 overflow-hidden pointer-events-none text-center break-words"
                        style={{ fontFamily, fontSize: Math.max(9, Math.min(height * 0.05, 16)) }}
                        data-testid={`overlay-text-${overlay.id}`}
                        data-fonts-ready="false"
                      >
                        {hasSpeaker ? `${overlay.speaker}: ${overlay.text}` : overlay.text}
                      </div>
                    );
                  }
                  const { minFontSize, maxFontSize } = defaultBubbleFontRange(imageBounds.height);
                  const layout = layoutBubbleText(measureWidth(fontFamily), overlay.text, width, height, {
                    minFontSize,
                    maxFontSize,
                    hasSpeaker,
                  });
                  return (
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center px-1 overflow-hidden pointer-events-none text-center"
                      style={{ fontFamily }}
                      data-testid={`overlay-text-${overlay.id}`}
                      data-fonts-ready="true"
                    >
                      {hasSpeaker && (
                        <span className="font-bold text-[#3a3a3a] block" style={{ fontSize: layout.speakerFontSize, lineHeight: 1.2 }}>
                          {overlay.speaker}
                        </span>
                      )}
                      <span className="text-[#1a1a1a]" style={{ fontSize: layout.fontSize, lineHeight: `${layout.lineHeight}px` }}>
                        {layout.lines.map((line, i) => (
                          <span key={i} className="block">{line}</span>
                        ))}
                      </span>
                    </div>
                  );
                })()}
                {isSelected && (
                  <div
                    onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, overlay.id, "resize"); }}
                    className="absolute bottom-0 right-0 w-2 h-2 bg-accent cursor-se-resize"
                    data-testid={`resize-${overlay.id}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Inspector panel */}
        <div className="w-52 border-l border-border p-3 overflow-y-auto flex-shrink-0">
          {/* Insert-from-script (#336): drop the cut's planned dialogue/narration/
              SFX straight into a prefilled overlay — no copy/paste out of JSON. */}
          {scriptLines.length > 0 && (
            <div className="mb-3 space-y-1.5" data-testid="script-insert-panel">
              <span className="text-[10px] font-medium text-muted">From script</span>
              <div className="flex flex-col gap-1">
                {scriptLines.map((line) => (
                  <button
                    key={line.key}
                    onClick={() => addScriptLine(line)}
                    data-testid={`script-insert-${line.key}`}
                    title={`Add ${line.type} overlay with this text`}
                    className="text-left px-2 py-1 text-[10px] border border-border rounded hover:border-accent hover:bg-accent/5"
                  >
                    <span className="font-medium text-accent">+ {TYPE_LABEL[line.type]}</span>{" "}
                    <span className="text-muted">
                      {line.speaker ? `${line.speaker}: ` : ""}
                      {line.text.length > 32 ? `${line.text.slice(0, 32)}…` : line.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {selectedOverlay ? (
            <div className="space-y-3">
              <p className="text-xs font-medium text-foreground">{TYPE_LABEL[selectedOverlay.type]}</p>

              {selectedOverlay.speaker !== undefined && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium text-muted">Speaker</span>
                  <input
                    value={selectedOverlay.speaker || ""}
                    onChange={(e) => updateOverlay(selectedOverlay.id, { speaker: e.target.value })}
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
                  onChange={(e) => updateOverlay(selectedOverlay.id, { text: e.target.value })}
                  rows={3}
                  className="w-full px-2 py-1 text-xs border border-border rounded bg-transparent resize-none focus:border-accent focus:outline-none"
                  placeholder="Overlay text"
                  data-testid="inspector-text"
                />
              </label>

              {selectedOverlay.type === "speech" && (() => {
                const tail = selectedOverlay.tailAnchor || { x: 0.5, y: 1.2 };
                return (
                  <div className="space-y-1">
                    <span className="text-[10px] font-medium text-muted">Tail anchor</span>
                    <div className="flex gap-2">
                      <label className="flex items-center gap-1 text-[10px] font-mono text-muted">
                        x
                        <input
                          type="number"
                          step="0.1"
                          value={tail.x}
                          onChange={(e) => updateOverlay(selectedOverlay.id, { tailAnchor: { ...tail, x: parseFloat(e.target.value) || 0 } })}
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
                          onChange={(e) => updateOverlay(selectedOverlay.id, { tailAnchor: { ...tail, y: parseFloat(e.target.value) || 0 } })}
                          className="w-14 px-1 py-0.5 text-[10px] border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                          data-testid="inspector-tail-y"
                        />
                      </label>
                    </div>
                  </div>
                );
              })()}

              <div className="text-[10px] text-muted" data-testid="inspector-font">
                Font: {selectedOverlay.type === "sfx" ? displayFont.family : bodyFont.family}
              </div>

              <div className="text-[10px] font-mono text-muted space-y-0.5">
                <p>x: {selectedOverlay.x.toFixed(3)}, y: {selectedOverlay.y.toFixed(3)}</p>
                <p>w: {selectedOverlay.width.toFixed(3)}, h: {selectedOverlay.height.toFixed(3)}</p>
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
            </div>
          ) : (
            <p className="text-xs text-muted" data-testid="inspector-empty">
              Select an overlay to inspect.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
