import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  bubbleLayoutOptionsForOverlay,
  balloonRadiusForOverlay,
  type Overlay,
} from "@app-lib/overlays";
import { layoutBubbleText } from "@app-lib/bubble-text";
import { textPanelDimensions } from "@app-lib/cuts";
import { useAuthedAsset } from "./asset-image";

type AuthFetch = (url: string, opts?: RequestInit) => Promise<Response>;

function loadFont(font: FontEntry) {
  const id = `gfont-${font.googleFontsId}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = getFontCdnUrl(font);
  document.head.appendChild(link);
}

interface CutOverlayPreviewProps {
  storyName: string;
  assetPath?: string | null;
  authFetch: AuthFetch;
  alt: string;
  overlays: Overlay[];
  language?: string;
  background?: string;
  aspectRatio?: string;
  className?: string;
  onClick?: () => void;
  testId?: string;
}

export function CutOverlayPreview({
  storyName,
  assetPath,
  authFetch,
  alt,
  overlays,
  language = "English",
  background,
  aspectRatio,
  className,
  onClick,
  testId,
}: CutOverlayPreviewProps) {
  const bodyFont = getDefaultFont(language);
  const displayFont = getDisplayFont();
  const bodyFontFamily = getFontFamily(bodyFont);
  const displayFontFamily = getFontFamily(displayFont);
  const asset = useAuthedAsset(storyName, assetPath, authFetch);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const measureContext = useMemo(
    () =>
      typeof document !== "undefined"
        ? document.createElement("canvas").getContext("2d")
        : null,
    [],
  );
  const [fontsReady, setFontsReady] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>(
    () => textPanelDimensions(aspectRatio) ?? { width: 800, height: 600 },
  );
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    loadFont(bodyFont);
    loadFont(displayFont);
  }, [bodyFont, displayFont]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (document.fonts?.load) {
          await Promise.all([
            document.fonts.load(`16px "${bodyFont.family}"`),
            document.fonts.load(`16px "${displayFont.family}"`),
          ]);
        }
      } catch {
        /* best effort */
      }
      if (!cancelled) setFontsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [bodyFont.family, displayFont.family]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setStageSize({
        width: el.clientWidth,
        height: el.clientHeight,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const measureWidth = useCallback(
    (fontFamily: string) =>
      (text: string, fontSize: number, fontWeight: 400 | 700 = 400): number => {
        if (!measureContext) return text.length * fontSize * 0.5;
        measureContext.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        return measureContext.measureText(text).width;
      },
    [measureContext],
  );

  const stage = (
    <div
      className={className ?? "w-full rounded border border-border bg-white"}
      data-testid={testId}
      ref={stageRef}
      style={{
        aspectRatio: `${naturalSize.width} / ${naturalSize.height}`,
        maxHeight: "32rem",
      }}
    >
      <div className="relative w-full h-full overflow-hidden rounded border border-border bg-white">
        {assetPath ? (
          asset.error || (!asset.loading && !asset.url) ? (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-muted bg-surface/40">
              Image not available
            </div>
          ) : asset.url ? (
            <img
              src={asset.url}
              alt={alt}
              className="absolute inset-0 w-full h-full object-contain"
              draggable={false}
              onLoad={(e) => {
                const width = e.currentTarget.naturalWidth || naturalSize.width;
                const height = e.currentTarget.naturalHeight || naturalSize.height;
                if (width > 0 && height > 0) setNaturalSize({ width, height });
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-muted bg-surface/40">
              Loading image…
            </div>
          )
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: background || "#101820" }}
          />
        )}

        {stageSize.width > 0 && stageSize.height > 0 && overlays.length > 0 && (
          <>
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              data-testid={testId ? `${testId}-overlay-layer` : undefined}
            >
              {overlays.map((overlay) => {
                if (overlay.type !== "speech") return null;
                const ox = overlay.x * stageSize.width;
                const oy = overlay.y * stageSize.height;
                const ow = overlay.width * stageSize.width;
                const oh = overlay.height * stageSize.height;
                const radius = balloonRadiusForOverlay(overlay, ow, oh);
                const tail = overlay.tailAnchor
                  ? speechTailPoints(ox, oy, ow, oh, overlay.tailAnchor, radius)
                  : null;
                const strokeW = Math.max(1.25, stageSize.height * 0.004);
                return (
                  <path
                    key={overlay.id}
                    data-testid={testId ? `${testId}-overlay-${overlay.id}` : undefined}
                    d={balloonPathD(ox, oy, ow, oh, tail, radius)}
                    className="fill-white/95 stroke-[#1a1a1a]"
                    strokeWidth={strokeW}
                    strokeLinejoin="round"
                  />
                );
              })}
            </svg>
            {overlays.map((overlay) => {
              const left = overlay.x * stageSize.width;
              const top = overlay.y * stageSize.height;
              const width = overlay.width * stageSize.width;
              const height = overlay.height * stageSize.height;
              const fontFamily =
                overlay.type === "sfx" ? displayFontFamily : bodyFontFamily;
              const isSpeech = overlay.type === "speech";
              const isNarration = overlay.type === "narration";
              const hasSpeaker = overlay.type !== "sfx" && !!overlay.speaker;
              return (
                <div
                  key={overlay.id}
                  className={`absolute rounded overflow-hidden ${
                    isSpeech ? "" : "border-2"
                  } ${
                    overlay.type === "narration"
                      ? "border-muted/40 bg-[#f4efe6]/85 rounded-md"
                      : overlay.type === "sfx"
                        ? "border-accent/40"
                        : ""
                  }`}
                  style={{ left, top, width, height }}
                >
                  {!overlay.text ? (
                    <span
                      className="block truncate px-1 text-[9px] text-muted"
                      style={{ fontFamily }}
                    >
                      {overlay.type}
                    </span>
                  ) : !fontsReady ? (
                    <div
                      className="absolute inset-0 flex items-center justify-center px-1 text-center break-words"
                      style={{
                        fontFamily,
                        fontSize: Math.max(8, Math.min(height * 0.05, 14)),
                        fontWeight: overlay.textStyle?.fontWeight ?? 400,
                      }}
                    >
                      {hasSpeaker ? `${overlay.speaker}: ${overlay.text}` : overlay.text}
                    </div>
                  ) : (
                    (() => {
                      const layout = layoutBubbleText(
                        measureWidth(fontFamily),
                        overlay.text,
                        width,
                        height,
                        bubbleLayoutOptionsForOverlay(
                          overlay,
                          stageSize.height,
                          width,
                          height,
                        ),
                      );
                      return (
                        <div
                          className="absolute inset-0 flex flex-col items-center justify-center px-1 text-center"
                          style={{ fontFamily }}
                        >
                          {hasSpeaker && (
                            <span
                              className="block font-bold text-[#3a3a3a]"
                              style={{
                                fontSize: layout.speakerFontSize,
                                lineHeight: 1.2,
                              }}
                            >
                              {overlay.speaker}
                            </span>
                          )}
                          <span
                            className="text-[#1a1a1a]"
                            style={{
                              fontSize: layout.fontSize,
                              lineHeight: `${layout.lineHeight}px`,
                              fontWeight: overlay.textStyle?.fontWeight ?? 400,
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
                    })()
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );

  if (!onClick) return stage;

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left"
      data-testid={testId ? `${testId}-open` : undefined}
    >
      {stage}
    </button>
  );
}
