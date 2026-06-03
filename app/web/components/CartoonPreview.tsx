import { useState, useEffect, useCallback } from "react";
import { AssetImage } from "./asset-image";
import { cutNextAction } from "@app-lib/cuts";

type AuthFetch = (url: string, opts?: RequestInit) => Promise<Response>;

interface CutDialogue {
  speaker: string;
  text: string;
}

interface Cut {
  id: number;
  shotType: string;
  description: string;
  characters: string[];
  dialogue: CutDialogue[];
  narration: string;
  sfx: string;
  cleanImagePath: string | null;
  finalImagePath: string | null;
  exportedAt: string | null;
  uploadedCid: string | null;
  uploadedUrl: string | null;
  kind?: "image" | "text";
  background?: string;
}

interface CutsFile {
  version: number;
  plotFile: string;
  cuts: Cut[];
}

interface CartoonPreviewProps {
  storyName: string;
  fileName: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  // #371: deep-link from a cut's next-action CTA into the Edit tab for that exact
  // cut. `opensEditor` is whether the lettering editor can open directly (clean
  // image / text panel / final) vs. just focusing the row to add clean art.
  onEditCut?: (cutId: number, opensEditor: boolean) => void;
}

function TextOverlay({ cut }: { cut: Cut }) {
  const hasText = cut.dialogue.length > 0 || cut.narration || cut.sfx;
  if (!hasText) return null;

  return (
    <div className="space-y-1.5" data-testid={`cut-${cut.id}-overlay`}>
      {cut.dialogue.map((d, i) => (
        <div key={i} className="flex gap-2 text-xs">
          <span className="font-medium text-foreground flex-shrink-0">{d.speaker}:</span>
          <span className="text-foreground">{d.text}</span>
        </div>
      ))}
      {cut.narration && (
        <div className="border-l-2 border-border pl-3">
          <p className="text-xs text-muted italic">{cut.narration}</p>
        </div>
      )}
      {cut.sfx && (
        <p className="text-xs font-mono text-muted">SFX: {cut.sfx}</p>
      )}
    </div>
  );
}

function CutCard({ cut, storyName, authFetch, onEditCut }: { cut: Cut; storyName: string; authFetch: AuthFetch; onEditCut?: (cutId: number, opensEditor: boolean) => void }) {
  const hasFinal = !!cut.finalImagePath;
  const hasClean = !!cut.cleanImagePath;
  const hasImage = hasFinal || hasClean;
  // A cut with no clean/final image is a planned image cut whose art is still
  // pending — even if narration/dialogue text already exists in cuts.json. It is
  // NOT a finished narration-only card.
  const hasPlannedText = cut.dialogue.length > 0 || !!cut.narration || !!cut.sfx;
  const isTextPanel = cut.kind === "text";

  return (
    <div className="space-y-2">
      {/* Cut header */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-muted bg-surface border border-border rounded px-1.5 py-0.5">
          #{cut.id}
        </span>
        <span className="text-[10px] font-mono text-muted">{cut.shotType}</span>
        {cut.characters.length > 0 && (
          <span className="text-[10px] text-muted truncate">
            {cut.characters.join(", ")}
          </span>
        )}
      </div>

      {/* Final image — lettered, no overlay needed */}
      {hasFinal && (
        <AssetImage
          storyName={storyName}
          assetPath={cut.finalImagePath!}
          authFetch={authFetch}
          alt={cut.description || `Cut ${cut.id}`}
        />
      )}

      {/* Clean image with text overlay */}
      {!hasFinal && hasClean && (
        <div className="border border-border rounded overflow-hidden">
          <AssetImage
            storyName={storyName}
            assetPath={cut.cleanImagePath!}
            authFetch={authFetch}
            alt={cut.description || `Cut ${cut.id}`}
          />
          <div className="px-3 py-2 bg-surface/80 border-t border-border">
            <TextOverlay cut={cut} />
          </div>
        </div>
      )}

      {/* Intentional text/interstitial panel (#351) — not pending art. Shows on
          its styled background; the text is the panel content, not a caption. */}
      {!hasImage && isTextPanel && (
        <div
          className="w-full border border-border rounded p-4 space-y-2"
          style={{ background: cut.background || undefined }}
          data-testid={`cut-${cut.id}-textpanel`}
        >
          <span className="text-[10px] font-mono text-muted">Text panel</span>
          {hasPlannedText ? (
            <TextOverlay cut={cut} />
          ) : (
            <p className="text-xs text-muted italic">Empty text panel — open the editor to add text.</p>
          )}
        </div>
      )}

      {/* Planned image cut — art not generated/uploaded yet */}
      {!hasImage && !isTextPanel && (
        <div
          className="w-full bg-surface border border-dashed border-border rounded p-4 space-y-2"
          data-testid={`cut-${cut.id}-pending`}
        >
          <div className="aspect-video flex flex-col items-center justify-center gap-1 text-center">
            <span className="text-xs text-muted font-medium">Image pending</span>
            <span className="text-[10px] text-muted">Planned image cut — generate &amp; upload the art</span>
          </div>
          {hasPlannedText && (
            <div className="border-t border-dashed border-border pt-2 space-y-1">
              <span className="text-[10px] font-mono text-muted">Planned text (will be lettered onto the image)</span>
              <TextOverlay cut={cut} />
            </div>
          )}
        </div>
      )}

      {/* Description */}
      {cut.description && (
        <p className="text-xs text-muted italic">{cut.description}</p>
      )}

      {/* Text shown below final images (already lettered, so just metadata) */}
      {hasFinal && (
        <TextOverlay cut={cut} />
      )}

      {/* #371: direct next-action CTA — jumps to the Edit tab for THIS cut so the
          writer never has to hunt for it in the cut list. Works for image cuts
          and text/interstitial panels alike. */}
      {onEditCut && (() => {
        const action = cutNextAction(cut);
        return (
          <button
            type="button"
            data-testid={`cut-${cut.id}-cta`}
            data-cut-action={action.key}
            onClick={() => onEditCut(cut.id, action.opensEditor)}
            className="w-full px-3 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-dim"
          >
            {action.label}
          </button>
        );
      })()}
    </div>
  );
}

export function CartoonPreview({ storyName, fileName, authFetch, onEditCut }: CartoonPreviewProps) {
  const [cutsFile, setCutsFile] = useState<CutsFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const plotFile = fileName.replace(/\.md$/, "");

  const loadCuts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}`);
      if (res.status === 404) {
        setCutsFile(null);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load cuts");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setCutsFile(data);
    } catch {
      setError("Failed to load cuts");
    } finally {
      setLoading(false);
    }
  }, [authFetch, storyName, plotFile]);

  useEffect(() => {
    loadCuts();
    const interval = setInterval(loadCuts, 5000);
    return () => clearInterval(interval);
  }, [loadCuts]);

  if (loading && !cutsFile) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        Loading cuts...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-4 text-center" data-testid="cuts-error">
        <p className="text-sm text-error font-medium">Invalid cuts file</p>
        <p className="text-xs text-error">{error}</p>
        <p className="text-xs text-muted max-w-sm">
          {plotFile}.cuts.json must follow the OWS v1 schema. Ask Claude to regenerate it using the v1 cuts schema shown in the cartoon writing instructions.
        </p>
        <button onClick={loadCuts} className="text-xs text-accent hover:text-accent-dim">
          Retry
        </button>
      </div>
    );
  }

  if (!cutsFile || cutsFile.cuts.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-muted">No cuts yet</p>
        <p className="text-xs text-muted">
          Ask Claude to create a cut plan for this episode.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {cutsFile.cuts.map((cut) => (
          <CutCard key={cut.id} cut={cut} storyName={storyName} authFetch={authFetch} onEditCut={onEditCut} />
        ))}
      </div>
    </div>
  );
}
