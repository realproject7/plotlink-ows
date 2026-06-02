import { useState, useEffect, useCallback, useRef } from "react";
import { LetteringEditor } from "./LetteringEditor";
import { AssetImage } from "./asset-image";
import { buildCodexTaskPrompt } from "@app-lib/cartoon-prompt";
import type { Cut as LibCut } from "@app-lib/cuts";
import { isTextPanel } from "@app-lib/cuts";
import { withRateLimitRetry, type RetryDeps } from "../lib/upload-retry";
import { importImageToCompliantBlob, isCompliantImage } from "../lib/import-image";

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
  kind?: "image" | "text";
  background?: string;
  aspectRatio?: string;
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
  // Rate-limit retry knobs (sleep/maxRetries/baseDelayMs) — injectable so tests
  // can run retries instantly. Production uses the defaults (#288).
  uploadRetry?: Pick<RetryDeps, "sleep" | "maxRetries" | "baseDelayMs">;
  // Notified whenever the cut plan is (re)loaded after a mutation — export,
  // upload, save overlays, generate-markdown (#343). Lets the parent PreviewPanel
  // refresh its own readiness/Episode-steps fetch so all status surfaces agree.
  onCutsChanged?: () => void;
}

type CutStatus = "missing" | "clean" | "lettered" | "uploaded" | "text";

function getCutStatus(cut: Cut): CutStatus {
  if (cut.uploadedCid) return "uploaded";
  if (cut.finalImagePath || cut.exportedAt) return "lettered";
  if (cut.cleanImagePath) return "clean";
  // A text/interstitial panel needs no clean image, so it's never "missing"
  // (#351) — it's ready to letter on its background.
  if (isTextPanel(cut)) return "text";
  return "missing";
}

const STATUS_LABEL: Record<CutStatus, string> = {
  missing: "No image",
  clean: "Clean ready",
  lettered: "Lettered",
  uploaded: "Uploaded",
  text: "Text panel",
};

const STATUS_COLOR: Record<CutStatus, string> = {
  missing: "text-muted",
  clean: "text-green-700",
  lettered: "text-amber-700",
  uploaded: "text-green-700",
  text: "text-accent",
};

const STATUS_DOT: Record<CutStatus, string> = {
  missing: "bg-muted/40",
  clean: "bg-green-600",
  lettered: "bg-amber-500",
  uploaded: "bg-green-600",
  text: "bg-accent",
};

function CutRow({
  cut,
  storyName,
  plotFile,
  expanded,
  onToggle,
  authFetch,
  onUpdated,
  onOpenEditor,
  detectedLocalClean,
  onSyncClean,
  syncing,
  staleMessages,
  onRepairStale,
  repairing,
}: {
  cut: Cut;
  storyName: string;
  plotFile: string;
  expanded: boolean;
  onToggle: () => void;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  onUpdated: () => void;
  onOpenEditor: () => void;
  detectedLocalClean: boolean;
  onSyncClean: () => void;
  syncing: boolean;
  staleMessages: string[];
  onRepairStale: () => void;
  repairing: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [askCopied, setAskCopied] = useState(false);
  const status = getCutStatus(cut);
  // A recorded cleanImagePath/finalImagePath whose file is missing/invalid (#302):
  // surface it precisely rather than letting the field-based status claim the cut
  // is image-ready.
  const hasStale = staleMessages.length > 0;

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      // Accept Codex-generated images (e.g. large PNG) by converting/compressing
      // them to a compliant WebP/JPEG <=1MB in the browser first (#301). An
      // already-compliant WebP/JPEG is passed through untouched, so the manual
      // upload behavior is unchanged. A source that cannot be decoded or
      // compressed under 1MB surfaces a clear error instead of saving anything.
      let upload: Blob = file;
      if (!isCompliantImage(file)) {
        try {
          upload = await importImageToCompliantBlob(file);
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : "Could not import image");
          return;
        }
      }

      const ext = upload.type === "image/jpeg" ? "jpg" : "webp";
      const formData = new FormData();
      formData.append("file", new File([upload], `clean.${ext}`, { type: upload.type }));
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
        <span className={`text-[10px] flex-shrink-0 ${hasStale ? "text-error" : STATUS_COLOR[status]}`}>
          {hasStale ? "Image missing" : STATUS_LABEL[status]}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border">
          {/* Stale recorded asset path (#302): the cut records a clean/final image
              path but the file is missing/invalid. Show the precise reason and a
              repair action that clears the stale clean AND final fields back to
              null (valid paths and uploaded URLs are preserved). */}
          {hasStale && (
            <div className="mt-2 rounded border border-error/40 bg-error/5 p-2 space-y-1" data-testid={`stale-asset-${cut.id}`}>
              {staleMessages.map((m, i) => (
                <p key={i} className="text-[11px] text-error">{m}</p>
              ))}
              <button
                onClick={onRepairStale}
                disabled={repairing}
                data-testid={`repair-stale-${cut.id}`}
                className="px-2 py-1 text-[11px] border border-error/40 text-error rounded hover:bg-error/10 disabled:opacity-50"
              >
                {repairing ? "Repairing…" : "Clear stale path"}
              </button>
            </div>
          )}

          {/* Clean image preview — loaded through authFetch since the asset
              route is behind requireAuth (a raw <img src> can't send the token). */}
          {cut.cleanImagePath && (
            <div className="mt-2">
              <AssetImage
                storyName={storyName}
                assetPath={cut.cleanImagePath}
                authFetch={authFetch}
                alt={`Cut ${cut.id} clean`}
                className="w-full max-h-48 object-contain rounded border border-border bg-white"
              />
            </div>
          )}

          {/* Clean image: copy generation prompt + upload the generated file */}
          <div className="mt-2 space-y-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(buildCodexTaskPrompt(cut as unknown as LibCut, plotFile));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              data-testid={`copy-prompt-${cut.id}`}
              className="px-3 py-1.5 text-xs border border-border rounded hover:border-accent hover:bg-accent/5"
            >
              {copied ? "Copied!" : "Copy Codex task"}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/webp,image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-3 py-1.5 text-xs border border-border rounded hover:border-accent hover:bg-accent/5 disabled:opacity-50"
              >
                {uploading ? "Uploading..." : cut.cleanImagePath ? "Replace clean image" : "Upload clean image"}
              </button>
            </div>
            {!cut.cleanImagePath && (
              <p className="text-xs text-muted" data-testid={`clean-image-handoff-${cut.id}`}>
                Generate externally, then upload clean image (PNG is converted to WebP automatically)
              </p>
            )}
            {status === "missing" && (
              <div
                className="rounded border border-border bg-surface/60 p-2 space-y-1"
                data-testid={`ask-codex-${cut.id}`}
              >
                <p className="text-[11px] font-medium text-foreground">Ask Codex to generate clean image</p>
                <p className="text-[10px] text-muted">
                  Paste this task into the Codex terminal to create{" "}
                  <span className="font-mono">assets/{plotFile}/cut-{String(cut.id).padStart(2, "0")}-clean.webp</span>,
                  then use &ldquo;Sync clean images&rdquo; (or it is auto-detected).
                </p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(buildCodexTaskPrompt(cut as unknown as LibCut, plotFile));
                    setAskCopied(true);
                    setTimeout(() => setAskCopied(false), 2000);
                  }}
                  data-testid={`ask-codex-copy-${cut.id}`}
                  className="px-2 py-1 text-[11px] border border-border rounded hover:border-accent hover:bg-accent/5"
                >
                  {askCopied ? "Copied!" : "Copy Codex task"}
                </button>
              </div>
            )}
            {status === "missing" && detectedLocalClean && (
              <button
                onClick={onSyncClean}
                disabled={syncing}
                data-testid={`found-local-clean-${cut.id}`}
                className="px-3 py-1.5 text-xs border border-green-700/40 text-green-700 rounded hover:bg-green-700/5 disabled:opacity-50"
              >
                {syncing ? "Syncing..." : "Found local clean image — sync to cut plan"}
              </button>
            )}
            {uploadError && (
              <p className="text-xs text-error mt-1">{uploadError}</p>
            )}
          </div>

          {/* Open editor — image cuts, narration cuts, and text panels (#351) */}
          {(cut.cleanImagePath || cut.narration || cut.dialogue.length > 0 || isTextPanel(cut)) && (
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

export function CutListPanel({ storyName, fileName, authFetch, language, uploadRetry, onCutsChanged }: CutListPanelProps) {
  const [cutsFile, setCutsFile] = useState<CutsFile | null>(null);
  // Latest onCutsChanged in a ref so loadCuts can notify the parent without
  // taking the callback as a dependency (which would churn loadCuts/effects).
  const onCutsChangedRef = useRef(onCutsChanged);
  onCutsChangedRef.current = onCutsChanged;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCut, setExpandedCut] = useState<number | null>(null);
  const [editingCutId, setEditingCutId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genWarnings, setGenWarnings] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [detected, setDetected] = useState<Set<number>>(new Set());
  // cutId → precise stale-path messages (#302), from detect-clean-images.
  const [staleByCut, setStaleByCut] = useState<Map<number, string[]>>(new Map());
  // True only after /detect-clean-images has SUCCESSFULLY verified the recorded
  // paths against disk (#311). Gates the "clean-assets-ready" banner so it never
  // claims completion from unverified cut-plan fields while detection is pending
  // or after it failed.
  const [detectConfirmed, setDetectConfirmed] = useState(false);

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
      // Tell the parent the cut plan changed so its readiness/Episode-steps view
      // refreshes in lockstep (e.g. after a lettering export, #343).
      onCutsChangedRef.current?.();
    } catch {
      setError("Failed to load cuts");
    } finally {
      setLoading(false);
    }
  }, [authFetch, storyName, plotFile]);

  // Server-confirmed detection of local clean files for cuts whose cleanImagePath
  // is still null. Best-effort: failures leave the detected set unchanged.
  const loadDetect = useCallback(async () => {
    // Until this detection resolves successfully, the recorded clean paths are
    // unverified — don't let the done banner claim completion (#311).
    setDetectConfirmed(false);
    try {
      const res = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}/detect-clean-images`);
      if (!res.ok) return;
      const data = await res.json();
      setDetected(new Set<number>(Array.isArray(data.detected) ? data.detected : []));
      const staleMap = new Map<number, string[]>();
      const staleList: unknown = data.stale;
      if (Array.isArray(staleList)) {
        for (const s of staleList) {
          if (typeof s?.cutId !== "number" || typeof s?.message !== "string") continue;
          const arr = staleMap.get(s.cutId) ?? [];
          arr.push(s.message);
          staleMap.set(s.cutId, arr);
        }
      }
      setStaleByCut(staleMap);
      setDetectConfirmed(true);
    } catch {
      /* ignore — affordance simply will not show */
    }
  }, [authFetch, storyName, plotFile]);

  const syncCleanImages = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    setGenWarnings([]);
    try {
      const res = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}/sync-clean-images`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncResult(data.error || "Sync failed");
      } else {
        const syncedCount = Array.isArray(data.synced) ? data.synced.length : 0;
        const clearedCount = Array.isArray(data.cleared) ? data.cleared.length : 0;
        const rejected = Array.isArray(data.rejected) ? data.rejected : [];
        if (rejected.length > 0) {
          setGenWarnings(rejected.map((r: { cutId: number; reason: string }) => `Cut ${r.cutId}: ${r.reason}`));
        }
        const parts: string[] = [];
        if (syncedCount > 0) parts.push(`Synced ${syncedCount}`);
        if (clearedCount > 0) parts.push(`Cleared ${clearedCount} stale path${clearedCount === 1 ? "" : "s"}`);
        setSyncResult(parts.length > 0 ? parts.join(", ") : "No new clean images");
        await loadCuts();
        await loadDetect();
      }
    } catch {
      setSyncResult("Sync failed");
    }
    setSyncing(false);
  }, [authFetch, storyName, plotFile, loadCuts, loadDetect]);

  // Clear stale recorded clean/final paths back to null (#302). Unlike sync,
  // this repairs a stale finalImagePath too; valid paths and uploaded URLs are
  // preserved server-side.
  const repairStalePaths = useCallback(async () => {
    setRepairing(true);
    setSyncResult(null);
    try {
      const res = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}/repair-asset-paths`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncResult(data.error || "Repair failed");
      } else {
        const clearedCount = Array.isArray(data.cleared) ? data.cleared.length : 0;
        setSyncResult(clearedCount > 0 ? `Cleared ${clearedCount} stale path${clearedCount === 1 ? "" : "s"}` : "No stale paths to clear");
        await loadCuts();
        await loadDetect();
      }
    } catch {
      setSyncResult("Repair failed");
    }
    setRepairing(false);
  }, [authFetch, storyName, plotFile, loadCuts, loadDetect]);

  useEffect(() => {
    loadCuts();
    loadDetect();
  }, [loadCuts, loadDetect]);

  if (loading) {
    return <div className="p-4 text-sm text-muted">Loading cuts...</div>;
  }

  if (error) {
    return (
      <div className="p-4 space-y-2" data-testid="cuts-error">
        <p className="text-sm text-error font-medium">Invalid cuts file</p>
        <p className="text-xs text-error">{error}</p>
        <p className="text-xs text-muted">
          {plotFile}.cuts.json must follow the OWS v1 schema. Ask Claude to regenerate it using the v1 cuts schema from the cartoon writing instructions.
        </p>
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
          title="Build the publish-ready episode from the uploaded cut images"
        >
          {generating ? "Preparing…" : "Prepare episode for publish"}
        </button>
        <button
          onClick={syncCleanImages}
          disabled={syncing}
          className="px-2 py-0.5 border border-accent/30 text-accent rounded hover:bg-accent/5 disabled:opacity-50"
          data-testid="sync-clean-btn"
        >
          {syncing ? "Syncing..." : "Sync clean images"}
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
                // Retry with backoff while the PlotLink endpoint rate-limits us
                // (5 uploads/min), instead of failing the whole batch (#288).
                // Already-uploaded cuts are skipped by the `!uploadedCid` filter
                // above, so a retry never re-uploads a recorded cut.
                const upload = await withRateLimitRetry(
                  async () => {
                    const res = await authFetch("/api/publish/upload-plot-image", { method: "POST", body: fd });
                    if (res.ok) {
                      const { cid, url } = await res.json();
                      return { ok: true as const, status: res.status, cid, url };
                    }
                    const e = await res.json().catch(() => ({}));
                    return { ok: false as const, status: res.status, errorMessage: (e as { error?: string }).error };
                  },
                  {
                    ...uploadRetry,
                    onWaiting: ({ attempt, maxRetries, waitMs }) =>
                      setUploadProgress(
                        `Cut ${ct.id} rate-limited — waiting ${Math.round(waitMs / 1000)}s before retry ${attempt}/${maxRetries}...`,
                      ),
                  },
                );
                if (!upload.ok) { errors.push(`Cut ${ct.id}: upload failed — ${upload.errorMessage || "unknown"}`); continue; }
                const { cid, url } = upload;
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
            setUploadProgress("Preparing publish markdown…");
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
          title="Upload each cut's final lettered image, then build the publish-ready episode markdown"
        >
          {uploadProgress || "Upload & Prepare for Publish"}
        </button>
      </div>
      {/* Clean-asset generation done-state (#311): when every cut has a present,
          valid clean image, surface a clear "done" signal so the operator knows
          Codex generation is complete even if the terminal session is still
          connected — no more guessing whether it is still Working. */}
      {detectConfirmed && cutsFile.cuts.length > 0 && stats.missing === 0 && staleByCut.size === 0 && (
        <div className="px-3 py-1 border-b border-border bg-green-600/10 text-[10px] text-green-700 flex items-center gap-1" data-testid="clean-assets-ready">
          <span aria-hidden>✓</span>
          <span>
            All {cutsFile.cuts.length} clean image{cutsFile.cuts.length === 1 ? "" : "s"} present — clean-asset generation is complete. Ready for lettering in OWS.
          </span>
        </div>
      )}
      {syncResult && (
        <div className="px-3 py-1 border-b border-border text-[10px] text-muted" data-testid="sync-result">
          {syncResult}
        </div>
      )}
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
            onUpdated={() => { loadCuts(); loadDetect(); }}
            onOpenEditor={() => setEditingCutId(cut.id)}
            detectedLocalClean={detected.has(cut.id)}
            onSyncClean={syncCleanImages}
            syncing={syncing}
            staleMessages={staleByCut.get(cut.id) ?? []}
            onRepairStale={repairStalePaths}
            repairing={repairing}
          />
        ))}
      </div>
    </div>
  );
}
