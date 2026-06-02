import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  getDefaultFont,
  getDisplayFont,
  getFontCdnUrl,
  getFontFamily,
  type FontEntry,
} from "@app-lib/fonts";
import { speechTailPoints, normalizeOverlays } from "@app-lib/overlays";
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
  dialogue?: { speaker: string; text: string }[];
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

  // Clean image lives behind requireAuth, so a raw <img src> would 401. Load it
  // via authFetch into a blob object URL and reuse that same URL for export.
  const cleanAsset = useAuthedAsset(storyName, cut.cleanImagePath, authFetch);
  // Repair agent-authored overlays (e.g. semantic `position` strings with no
  // numeric geometry) on load so the bubbles actually render and export — and
  // surface a note when some could not be auto-placed (#309).
  const overlayNormalization = useMemo(() => normalizeOverlays(cut.overlays), [cut.overlays]);
  const overlayRepairNote = useMemo(() => {
    const n = overlayNormalization;
    if (n.invalid.length > 0) {
      const c = n.invalid.length;
      return `${c} overlay${c === 1 ? "" : "s"} from the cut plan had no usable position and ${c === 1 ? "was" : "were"} removed — re-add ${c === 1 ? "it" : "them"} here before exporting.`;
    }
    if (n.changed && n.overlays.length > 0) {
      return "Auto-placed overlays from the cut plan — review their positions before exporting.";
    }
    return null;
  }, [overlayNormalization]);
  const [overlays, setOverlays] = useState<Overlay[]>(() => overlayNormalization.overlays as Overlay[]);
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
    const img = imgRef.current;
    if (!container || !img || !img.naturalWidth) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih);
    const rw = iw * scale;
    const rh = ih * scale;
    setImageBounds({ x: (cw - rw) / 2, y: (ch - rh) / 2, width: rw, height: rh });
  }, []);

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
      const blob = await exportCut(imgUrl, overlays, bodyFontFamily, displayFontFamily, {
        narration: cut.narration,
        dialogue: cut.dialogue,
      });

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
        onExported?.();
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [cut, cleanAsset, overlays, storyName, plotFile, bodyFont, displayFont, bodyFontFamily, displayFontFamily, authFetch, onSave, onExported]);

  const selectedOverlay = overlays.find((o) => o.id === selectedId);

  const isNarrationCut = !cut.cleanImagePath;

  if (isNarrationCut && overlays.length === 0 && !cut.narration && !cut.dialogue?.length) {
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

      {overlayRepairNote && (
        <div className="px-3 py-1 border-b border-border bg-amber-500/10 text-[10px] text-amber-700" data-testid="overlay-repair-note">
          {overlayRepairNote}
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

          {/* Speech-bubble tails, drawn under the overlay boxes so the box
              sits on top of the tail base — mirrors the export rendering so
              tail-anchor edits are visible here, not only in the final image. */}
          {imageBounds.width > 0 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none" data-testid="tail-layer">
              {overlays.map((overlay) => {
                if (overlay.type !== "speech" || !overlay.tailAnchor) return null;
                const ox = imageBounds.x + toPixel(overlay.x, imageBounds.width);
                const oy = imageBounds.y + toPixel(overlay.y, imageBounds.height);
                const ow = toPixel(overlay.width, imageBounds.width);
                const oh = toPixel(overlay.height, imageBounds.height);
                const pts = speechTailPoints(ox, oy, ow, oh, overlay.tailAnchor);
                if (!pts) return null;
                return (
                  <polygon
                    key={overlay.id}
                    data-testid={`tail-${overlay.id}`}
                    points={`${pts.base1.x},${pts.base1.y} ${pts.tip.x},${pts.tip.y} ${pts.base2.x},${pts.base2.y}`}
                    className="fill-white/80 stroke-foreground/40"
                    strokeWidth={1}
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

            return (
              <div
                key={overlay.id}
                data-testid={`overlay-${overlay.id}`}
                onClick={(e) => handleOverlayClick(e, overlay.id)}
                onMouseDown={(e) => handleMouseDown(e, overlay.id, "move")}
                className={`absolute border-2 rounded cursor-move select-none ${TYPE_BORDER[overlay.type]} ${
                  isSelected ? "ring-2 ring-accent" : ""
                }`}
                style={{ left, top, width, height }}
              >
                <span
                  className="text-[9px] px-1 text-muted truncate block pointer-events-none"
                  style={{ fontFamily: overlay.type === "sfx" ? displayFontFamily : bodyFontFamily }}
                >
                  {overlay.text || TYPE_LABEL[overlay.type]}
                </span>
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
