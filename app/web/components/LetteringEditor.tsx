import { useState, useRef, useEffect, useCallback } from "react";

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
}

function toPixel(norm: number, containerSize: number): number {
  return norm * containerSize;
}

interface Cut {
  id: number;
  cleanImagePath: string | null;
  overlays: Overlay[];
}

interface LetteringEditorProps {
  storyName: string;
  cut: Cut;
  onSave: (overlays: Overlay[]) => void;
  onClose: () => void;
}

function assetUrl(storyName: string, assetPath: string): string {
  const relative = assetPath.startsWith("assets/") ? assetPath.slice(7) : assetPath;
  return `/api/stories/${storyName}/asset/${relative}`;
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

export function LetteringEditor({ storyName, cut, onSave, onClose }: LetteringEditorProps) {
  const [overlays] = useState<Overlay[]>(cut.overlays || []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleOverlayClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedId(id);
  }, []);

  const handleSave = useCallback(() => {
    onSave(overlays);
  }, [overlays, onSave]);

  const selectedOverlay = overlays.find((o) => o.id === selectedId);

  if (!cut.cleanImagePath) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted">
        No clean image — upload one first.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted">Cut #{cut.id} — Editor</span>
          <span className="text-[10px] text-muted">{overlays.length} overlays</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-dim"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs text-muted hover:text-foreground border border-border rounded"
          >
            Close
          </button>
        </div>
      </div>

      {/* Editor surface */}
      <div className="flex-1 min-h-0 flex">
        <div
          ref={containerRef}
          className="flex-1 min-w-0 relative overflow-hidden"
          onClick={handleBackgroundClick}
          data-testid="editor-surface"
        >
          <img
            src={assetUrl(storyName, cut.cleanImagePath)}
            alt={`Cut ${cut.id} clean`}
            className="w-full h-full object-contain"
            draggable={false}
          />

          {/* Overlay elements */}
          {containerSize.width > 0 && overlays.map((overlay) => {
            const left = toPixel(overlay.x, containerSize.width);
            const top = toPixel(overlay.y, containerSize.height);
            const width = toPixel(overlay.width, containerSize.width);
            const height = toPixel(overlay.height, containerSize.height);
            const isSelected = overlay.id === selectedId;

            return (
              <div
                key={overlay.id}
                data-testid={`overlay-${overlay.id}`}
                onClick={(e) => handleOverlayClick(e, overlay.id)}
                className={`absolute border-2 rounded cursor-pointer ${TYPE_BORDER[overlay.type]} ${
                  isSelected ? "ring-2 ring-accent" : ""
                }`}
                style={{ left, top, width, height }}
              >
                <span className="text-[9px] px-1 text-muted truncate block">
                  {overlay.text || TYPE_LABEL[overlay.type]}
                </span>
              </div>
            );
          })}
        </div>

        {/* Inspector panel */}
        <div className="w-48 border-l border-border p-3 overflow-y-auto flex-shrink-0">
          {selectedOverlay ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">{TYPE_LABEL[selectedOverlay.type]}</p>
              {selectedOverlay.speaker !== undefined && (
                <div className="text-[10px] text-muted">
                  <span className="font-medium">Speaker:</span> {selectedOverlay.speaker || "(none)"}
                </div>
              )}
              <div className="text-[10px] text-muted">
                <span className="font-medium">Text:</span> {selectedOverlay.text || "(empty)"}
              </div>
              <div className="text-[10px] font-mono text-muted space-y-0.5">
                <p>x: {selectedOverlay.x.toFixed(3)}</p>
                <p>y: {selectedOverlay.y.toFixed(3)}</p>
                <p>w: {selectedOverlay.width.toFixed(3)}</p>
                <p>h: {selectedOverlay.height.toFixed(3)}</p>
              </div>
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
