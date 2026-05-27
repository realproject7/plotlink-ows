import { useState, useEffect, useCallback } from "react";

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
}

function assetUrl(storyName: string, assetPath: string): string {
  const relative = assetPath.startsWith("assets/") ? assetPath.slice(7) : assetPath;
  return `/api/stories/${storyName}/asset/${relative}`;
}

function CutImage({ src, alt }: { src: string; alt: string }) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="w-full aspect-video bg-surface border border-border rounded flex items-center justify-center">
        <span className="text-xs text-muted">Image not available</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setError(true)}
      className="w-full rounded border border-border"
    />
  );
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

function CutCard({ cut, storyName }: { cut: Cut; storyName: string }) {
  const hasFinal = !!cut.finalImagePath;
  const hasClean = !!cut.cleanImagePath;
  const hasImage = hasFinal || hasClean;
  const isNarrationOnly = !hasImage && (cut.narration || cut.dialogue.length > 0);

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
        <CutImage
          src={assetUrl(storyName, cut.finalImagePath!)}
          alt={cut.description || `Cut ${cut.id}`}
        />
      )}

      {/* Clean image with text overlay */}
      {!hasFinal && hasClean && (
        <div className="border border-border rounded overflow-hidden">
          <CutImage
            src={assetUrl(storyName, cut.cleanImagePath!)}
            alt={cut.description || `Cut ${cut.id}`}
          />
          <div className="px-3 py-2 bg-surface/80 border-t border-border">
            <TextOverlay cut={cut} />
          </div>
        </div>
      )}

      {/* Narration-only placeholder */}
      {isNarrationOnly && (
        <div className="w-full bg-surface border border-border rounded p-4 space-y-2">
          <span className="text-[10px] font-mono text-muted">Narration cut</span>
          <TextOverlay cut={cut} />
        </div>
      )}

      {/* No content placeholder */}
      {!hasImage && !isNarrationOnly && (
        <div className="w-full aspect-video bg-surface border border-dashed border-border rounded flex items-center justify-center">
          <span className="text-xs text-muted">No image yet</span>
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
    </div>
  );
}

export function CartoonPreview({ storyName, fileName, authFetch }: CartoonPreviewProps) {
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
      <div className="h-full flex flex-col items-center justify-center gap-2 px-4">
        <p className="text-sm text-error">{error}</p>
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
          <CutCard key={cut.id} cut={cut} storyName={storyName} />
        ))}
      </div>
    </div>
  );
}
