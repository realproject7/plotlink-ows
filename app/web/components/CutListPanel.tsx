import { useState, useEffect, useCallback, useRef } from "react";
import { LetteringEditor } from "./LetteringEditor";

interface Overlay {
  id: string;
  type: "speech" | "narration" | "sfx";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  speaker?: string;
}

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
  overlays: Overlay[];
}

interface CutsFile {
  version: number;
  plotFile: string;
  cuts: Cut[];
}

interface CutListPanelProps {
  storyName: string;
  fileName: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  language?: string;
}

type CutStatus = "missing" | "clean" | "lettered" | "uploaded";

function getCutStatus(cut: Cut): CutStatus {
  if (cut.uploadedCid) return "uploaded";
  if (cut.finalImagePath || cut.exportedAt) return "lettered";
  if (cut.cleanImagePath) return "clean";
  return "missing";
}

const STATUS_LABEL: Record<CutStatus, string> = {
  missing: "No image",
  clean: "Clean ready",
  lettered: "Lettered",
  uploaded: "Uploaded",
};

const STATUS_COLOR: Record<CutStatus, string> = {
  missing: "text-muted",
  clean: "text-green-700",
  lettered: "text-amber-700",
  uploaded: "text-green-700",
};

const STATUS_DOT: Record<CutStatus, string> = {
  missing: "bg-muted/40",
  clean: "bg-green-600",
  lettered: "bg-amber-500",
  uploaded: "bg-green-600",
};

function assetUrl(storyName: string, assetPath: string): string {
  const relative = assetPath.startsWith("assets/") ? assetPath.slice(7) : assetPath;
  return `/api/stories/${storyName}/asset/${relative}`;
}

function CutRow({
  cut,
  storyName,
  plotFile,
  expanded,
  onToggle,
  authFetch,
  onUpdated,
  onOpenEditor,
}: {
  cut: Cut;
  storyName: string;
  plotFile: string;
  expanded: boolean;
  onToggle: () => void;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  onUpdated: () => void;
  onOpenEditor: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const status = getCutStatus(cut);

  const handleUpload = useCallback(async (file: File) => {
    if (file.size > 1024 * 1024) {
      setUploadError("File must be under 1MB");
      return;
    }
    if (file.type !== "image/webp" && file.type !== "image/jpeg") {
      setUploadError("Only WebP and JPEG supported");
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch(
        `/api/stories/${storyName}/cuts/${plotFile}/upload-clean/${cut.id}`,
        { method: "POST", body: formData },
      );
      if (!res.ok) {
        const data = await res.json();
        setUploadError(data.error || "Upload failed");
      } else {
        onUpdated();
      }
    } catch {
      setUploadError("Upload failed");
    } finally {
      setUploading(false);
    }
  }, [authFetch, storyName, plotFile, cut.id, onUpdated]);

  return (
    <div className={`border rounded ${expanded ? "border-accent/30" : "border-border"}`}>
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 text-left flex items-center gap-2 text-sm hover:bg-surface"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[status]}`} />
        <span className="font-mono text-xs text-muted">#{cut.id}</span>
        <span className="font-mono text-[10px] text-muted">{cut.shotType}</span>
        <span className="truncate text-xs text-foreground flex-1">
          {cut.description || "No description"}
        </span>
        <span className={`text-[10px] flex-shrink-0 ${STATUS_COLOR[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border">
          {/* Clean image preview */}
          {cut.cleanImagePath && (
            <div className="mt-2">
              <img
                src={assetUrl(storyName, cut.cleanImagePath)}
                alt={`Cut ${cut.id} clean`}
                className="w-full max-h-48 object-contain rounded border border-border bg-white"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}

          {/* Upload area */}
          <div className="mt-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/webp,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 text-xs border border-border rounded hover:border-accent hover:bg-accent/5 disabled:opacity-50"
            >
              {uploading ? "Uploading..." : cut.cleanImagePath ? "Replace clean image" : "Upload clean image"}
            </button>
            {uploadError && (
              <p className="text-xs text-error mt-1">{uploadError}</p>
            )}
          </div>

          {/* Open editor button — available for image cuts and narration cuts */}
          {(cut.cleanImagePath || cut.narration || cut.dialogue.length > 0) && (
            <button
              onClick={onOpenEditor}
              className="px-3 py-1.5 text-xs border border-accent/30 text-accent rounded hover:bg-accent/5"
            >
              Open editor
            </button>
          )}

          {/* Cut metadata */}
          {cut.characters.length > 0 && (
            <p className="text-xs text-muted">Characters: {cut.characters.join(", ")}</p>
          )}
          {cut.dialogue.length > 0 && (
            <div className="text-xs text-muted">
              {cut.dialogue.map((d, i) => (
                <p key={i}><span className="font-medium">{d.speaker}:</span> {d.text}</p>
              ))}
            </div>
          )}
          {cut.narration && (
            <p className="text-xs text-muted italic">{cut.narration}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function CutListPanel({ storyName, fileName, authFetch, language }: CutListPanelProps) {
  const [cutsFile, setCutsFile] = useState<CutsFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCut, setExpandedCut] = useState<number | null>(null);
  const [editingCutId, setEditingCutId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genWarnings, setGenWarnings] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  const plotFile = fileName.replace(/\.md$/, "");

  const loadCuts = useCallback(async () => {
    try {
      const res = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}`);
      if (res.status === 404) {
        setCutsFile(null);
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load cuts");
        return;
      }
      setCutsFile(await res.json());
      setError(null);
    } catch {
      setError("Failed to load cuts");
    } finally {
      setLoading(false);
    }
  }, [authFetch, storyName, plotFile]);

  useEffect(() => {
    loadCuts();
  }, [loadCuts]);

  if (loading) {
    return <div className="p-4 text-sm text-muted">Loading cuts...</div>;
  }

  if (error) {
    return (
      <div className="p-4 space-y-2">
        <p className="text-sm text-error">{error}</p>
        <button onClick={loadCuts} className="text-xs text-accent hover:text-accent-dim">Retry</button>
      </div>
    );
  }

  if (!cutsFile || cutsFile.cuts.length === 0) {
    return (
      <div className="p-4 text-center space-y-1">
        <p className="text-sm text-muted">No cuts yet</p>
        <p className="text-xs text-muted">Ask Claude to create a cut plan for this episode.</p>
      </div>
    );
  }

  const editingCut = editingCutId !== null ? cutsFile.cuts.find((c) => c.id === editingCutId) : null;

  if (editingCut) {
    return (
      <LetteringEditor
        storyName={storyName}
        cut={editingCut}
        plotFile={plotFile}
        language={language}
        authFetch={authFetch}
        onSave={async (overlays: Overlay[]) => {
          const updated = { ...cutsFile, cuts: cutsFile.cuts.map((c) => c.id === editingCutId ? { ...c, overlays } : c) };
          const res = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updated),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to save overlays");
          }
        }}
        onExported={() => loadCuts()}
        onClose={() => { setEditingCutId(null); loadCuts(); }}
      />
    );
  }

  const stats = cutsFile.cuts.reduce(
    (acc, cut) => {
      const s = getCutStatus(cut);
      acc[s]++;
      return acc;
    },
    { missing: 0, clean: 0, lettered: 0, uploaded: 0 } as Record<CutStatus, number>,
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header with stats */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-3 text-[10px]">
        <span className="font-mono text-muted">{cutsFile.cuts.length} cuts</span>
        {stats.missing > 0 && <span className="text-muted">{stats.missing} missing</span>}
        {stats.clean > 0 && <span className="text-green-700">{stats.clean} clean</span>}
        {stats.lettered > 0 && <span className="text-amber-700">{stats.lettered} lettered</span>}
        {stats.uploaded > 0 && <span className="text-green-700">{stats.uploaded} uploaded</span>}
        <button
          onClick={async () => {
            setGenerating(true);
            setGenWarnings([]);
            try {
              const res = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}/generate-markdown`, { method: "POST" });
              if (res.ok) {
                const data = await res.json();
                setGenWarnings(data.warnings || []);
              }
            } catch { /* ignore */ }
            setGenerating(false);
          }}
          disabled={generating}
          className="ml-auto px-2 py-0.5 border border-accent/30 text-accent rounded hover:bg-accent/5 disabled:opacity-50"
          data-testid="generate-markdown-btn"
        >
          {generating ? "Generating..." : "Generate MD"}
        </button>
        <button
          onClick={async () => {
            if (!cutsFile) return;
            setUploading(true);
            setUploadProgress("");
            setGenWarnings([]);
            const toUpload = cutsFile.cuts.filter((ct) => ct.finalImagePath && !ct.uploadedCid);
            const errors: string[] = [];
            for (let i = 0; i < toUpload.length; i++) {
              const ct = toUpload[i];
              setUploadProgress(`Uploading cut ${ct.id} (${i + 1}/${toUpload.length})...`);
              try {
                const assetRel = ct.finalImagePath!.startsWith("assets/") ? ct.finalImagePath!.slice(7) : ct.finalImagePath!;
                const imgRes = await authFetch(`/api/stories/${storyName}/asset/${assetRel}`);
                if (!imgRes.ok) { errors.push(`Cut ${ct.id}: failed to fetch asset`); continue; }
                const blob = await imgRes.blob();
                const fd = new FormData();
                fd.append("file", blob, `cut-${ct.id}.${blob.type === "image/webp" ? "webp" : "jpg"}`);
                const upRes = await authFetch("/api/publish/upload-plot-image", { method: "POST", body: fd });
                if (!upRes.ok) { const e = await upRes.json().catch(() => ({})); errors.push(`Cut ${ct.id}: upload failed — ${e.error || "unknown"}`); continue; }
                const { cid, url } = await upRes.json();
                const setRes = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}/set-uploaded/${ct.id}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ cid, url }),
                });
                if (!setRes.ok) { errors.push(`Cut ${ct.id}: failed to record upload`); }
              } catch (err) {
                errors.push(`Cut ${ct.id}: ${err instanceof Error ? err.message : "failed"}`);
              }
            }
            if (errors.length > 0) {
              setGenWarnings(errors);
              setUploading(false);
              setUploadProgress("");
              loadCuts();
              return;
            }
            setUploadProgress("Generating markdown...");
            const mdRes = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}/generate-markdown`, { method: "POST" });
            if (mdRes.ok) {
              const data = await mdRes.json();
              if (data.warnings?.length > 0) setGenWarnings(data.warnings);
            }
            setUploading(false);
            setUploadProgress("");
            loadCuts();
          }}
          disabled={uploading || !cutsFile?.cuts.some((ct) => ct.finalImagePath && !ct.uploadedCid)}
          className="px-2 py-0.5 border border-accent/30 text-accent rounded hover:bg-accent/5 disabled:opacity-50"
          data-testid="upload-generate-btn"
        >
          {uploadProgress || "Upload & Generate"}
        </button>
      </div>
      {genWarnings.length > 0 && (
        <div className="px-3 py-1 border-b border-border text-[10px] text-amber-700">
          {genWarnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}

      {/* Cut list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {cutsFile.cuts.map((cut) => (
          <CutRow
            key={cut.id}
            cut={cut}
            storyName={storyName}
            plotFile={plotFile}
            expanded={expandedCut === cut.id}
            onToggle={() => setExpandedCut(expandedCut === cut.id ? null : cut.id)}
            authFetch={authFetch}
            onUpdated={loadCuts}
            onOpenEditor={() => setEditingCutId(cut.id)}
          />
        ))}
      </div>
    </div>
  );
}
