import { Fragment, useState, useEffect, useCallback, useRef } from "react";
import { LetteringEditor } from "./LetteringEditor";
import { AssetImage, assetUrl } from "./asset-image";
import { buildCodexTaskPrompt } from "@app-lib/cartoon-prompt";
import type { Cut as LibCut } from "@app-lib/cuts";
import { isTextPanel, isStaleTailedExport } from "@app-lib/cuts";
import { withRateLimitRetry, createUploadThrottle, type RetryDeps } from "../lib/upload-retry";
import { importImageToCompliantBlob, isCompliantImage } from "../lib/import-image";
import { CodexImportPicker } from "./CodexImportPicker";
import { FinishEpisodePanel } from "./FinishEpisodePanel";
import { cartoonChecklist, checkMarkdownReadiness } from "@app-lib/cartoon-readiness";
import { summarizeAssetDiagnostics, type CutAssetDiagnostic } from "@app-lib/cut-asset-diagnostics";

interface Overlay {
  id: string;
  type: "speech" | "narration" | "sfx";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  speaker?: string;
  tailAnchor?: { x: number; y: number };
  textStyle?: {
    mode?: "auto" | "manual";
    fontScale?: number;
    lineHeightFactor?: number;
    speakerScale?: number;
  };
  bubbleStyle?: {
    paddingX?: number;
    paddingY?: number;
    cornerRadius?: number;
  };
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
  finalRendererVersion?: number;
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
  // #371: a deep-link request from the Preview / Cut Inspector CTA. When it
  // changes (by `seq`), focus that cut — open the lettering editor when
  // `openEditor`, otherwise expand and scroll its row into view. `onFocusHandled`
  // is called once applied so the parent can clear the request.
  focusRequest?: { cutId: number; openEditor: boolean; seq: number } | null;
  onFocusHandled?: () => void;
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

// Creator-facing production-board status for a cut card (#440). One clear label
// per cut + the single primary human action, instead of internal field names.
type BoardTone = "muted" | "amber" | "green" | "accent";
const BOARD_TONE_TEXT: Record<BoardTone, string> = {
  muted: "text-muted", amber: "text-amber-700", green: "text-green-700", accent: "text-accent",
};
const BOARD_TONE_DOT: Record<BoardTone, string> = {
  muted: "bg-muted/40", amber: "bg-amber-500", green: "bg-green-600", accent: "bg-accent",
};

type BoardStatusKey = "uploaded" | "exported" | "convert" | "text" | "review" | "letter" | "needs-image";
interface BoardStatus { key: BoardStatusKey; label: string; tone: BoardTone }

/**
 * Map a cut's real state to one creator-facing board status (#440). `.png` clean
 * images are "Needs conversion" (#441), never a red error; a recorded-but-missing
 * path reads as "Needs image" (re-add the art) with the precise repair kept in
 * Details. Precedence follows the pipeline: uploaded → exported → convert →
 * letter/review → needs image.
 */
function boardStatus(cut: Cut, needsConversion: boolean, hasStale: boolean): BoardStatus {
  // Uploaded content lives on IPFS, so a missing LOCAL file is not a defect.
  if (cut.uploadedCid || cut.uploadedUrl) return { key: "uploaded", label: "Uploaded", tone: "green" };
  // PNG clean art is an actionable conversion step (#441).
  if (needsConversion) return { key: "convert", label: "Needs conversion", tone: "amber" };
  // A recorded asset path that's broken on disk (#302) must NOT read as a
  // finished "Exported"/clean cut (#440 RE1): a recorded final needs
  // re-review/re-export; otherwise the clean art is gone → needs image. The
  // precise repair lives in the card's Open details.
  if (hasStale) {
    return cut.finalImagePath
      ? { key: "review", label: "Needs review", tone: "amber" }
      : { key: "needs-image", label: "Needs image", tone: "muted" };
  }
  if (cut.finalImagePath) return { key: "exported", label: "Exported", tone: "green" };
  if (isTextPanel(cut)) return { key: "text", label: "Ready for captions", tone: "accent" };
  if (cut.cleanImagePath) {
    return (cut.overlays?.length ?? 0) > 0
      ? { key: "review", label: "Needs review", tone: "amber" }
      : { key: "letter", label: "Ready for lettering", tone: "green" };
  }
  return { key: "needs-image", label: "Needs image", tone: "muted" };
}

function letteringReviewState(cut: Cut): { label: string; detail: string; tone: BoardTone } {
  if (cut.uploadedCid || cut.uploadedUrl) {
    return { label: "Complete", detail: "Final image uploaded", tone: "green" };
  }
  if (cut.finalImagePath || cut.exportedAt) {
    return { label: "Exported", detail: "Ready to upload", tone: "green" };
  }
  if ((cut.overlays?.length ?? 0) > 0) {
    return { label: "Draft saved", detail: `${cut.overlays.length} overlay${cut.overlays.length === 1 ? "" : "s"} placed`, tone: "amber" };
  }
  if (isTextPanel(cut)) {
    return { label: "Between-scene card", detail: "Open to add narration or title text", tone: "accent" };
  }
  if (cut.cleanImagePath) {
    return { label: "Unlettered", detail: "Clean art ready for bubble placement", tone: "muted" };
  }
  return { label: "Needs artwork", detail: "Add or sync clean art first", tone: "muted" };
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
  detectedLocalClean,
  onSyncClean,
  syncing,
  staleMessages,
  onRepairStale,
  repairing,
  conversionPng,
  onConvert,
  converting,
  rowRef,
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
  /** When set, this cut has a PNG clean image at this path awaiting conversion (#441). */
  conversionPng: string | null;
  onConvert: (cutId: number, pngPath: string) => Promise<boolean>;
  converting: boolean;
  rowRef?: (el: HTMLDivElement | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [askCopied, setAskCopied] = useState(false);
  // #403: show the Codex generated-image cache picker so a writer imports a
  // generated PNG into this cut without hunting through a hidden folder.
  const [showCodexPicker, setShowCodexPicker] = useState(false);
  const [convertingThis, setConvertingThis] = useState(false);
  const status = getCutStatus(cut);
  // A recorded cleanImagePath/finalImagePath whose file is missing/invalid (#302):
  // surface it precisely rather than letting the field-based status claim the cut
  // is image-ready.
  const hasStale = staleMessages.length > 0;
  // A PNG clean image awaiting conversion (#441) is a normal step, not an error —
  // it takes precedence over the stale/missing framing for this cut.
  const needsConversion = !!conversionPng;

  const handleConvertThis = useCallback(async () => {
    if (!conversionPng) return;
    setConvertingThis(true);
    await onConvert(cut.id, conversionPng);
    setConvertingThis(false);
    onUpdated();
  }, [conversionPng, onConvert, cut.id, onUpdated]);

  // Returns true on a successful upload so callers (e.g. the Codex import picker)
  // can close themselves only when the clean image was actually recorded.
  const handleUpload = useCallback(async (file: File): Promise<boolean> => {
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
          return false;
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
        return false;
      }
      onUpdated();
      return true;
    } catch {
      setUploadError("Upload failed");
      return false;
    } finally {
      setUploading(false);
    }
  }, [authFetch, storyName, plotFile, cut.id, onUpdated]);

  // Creator-facing board status + the single primary action for this cut (#440).
  const board = boardStatus(cut, needsConversion, hasStale);
  // A viewable thumbnail: the recorded clean image (the asset route serves PNG
  // too, so a draft PNG previews) or the unrecorded convertible PNG.
  const thumbPath = cut.cleanImagePath ?? conversionPng ?? null;
  // A cut sitting at the lettering step (#442): clean art is ready, nothing is
  // exported/uploaded yet, and it isn't blocked on convert/stale. These get the
  // first-class Manual/AI-draft lettering choice instead of a single button.
  const bubblesPlaced = cut.overlays?.length ?? 0;
  const atLetteringStage =
    !isTextPanel(cut) && !!cut.cleanImagePath && !cut.finalImagePath &&
    !cut.uploadedCid && !cut.uploadedUrl && !hasStale && !needsConversion;

  const primary: { label: string; onClick: () => void; testid: string } | null =
    board.key === "convert" ? { label: convertingThis ? "Converting…" : "Convert image", onClick: handleConvertThis, testid: `card-convert-${cut.id}` }
    : board.key === "review" ? { label: "Review cut", onClick: onOpenEditor, testid: `card-review-${cut.id}` }
    : board.key === "text" ? { label: "Add captions", onClick: onOpenEditor, testid: `card-letter-${cut.id}` }
    : board.key === "needs-image" ? { label: "Add artwork", onClick: onToggle, testid: `card-addart-${cut.id}` }
    : null; // exported / uploaded — the next action is the episode-level upload/publish
  const reviewState = letteringReviewState(cut);

  return (
    <div
      ref={rowRef}
      data-cut-row={cut.id}
      className={`border rounded ${expanded ? "border-accent/30" : "border-border"}`}
    >
      {/* Card head — always visible: status, identity, thumbnail, one primary
          action, plus an "Open details" toggle for the technical controls (#440). */}
      <div className="px-3 py-2 space-y-2" data-testid={`cut-card-${cut.id}`}>
        <div className="flex items-center gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${BOARD_TONE_DOT[board.tone]}`} />
          <span className="font-medium text-xs text-foreground">Cut {String(cut.id).padStart(2, "0")}</span>
          <span className="font-mono text-[10px] text-muted">· {cut.shotType}</span>
          <span className={`ml-auto text-[10px] font-medium flex-shrink-0 ${BOARD_TONE_TEXT[board.tone]}`} data-testid={`cut-card-status-${cut.id}`}>
            {board.label}
          </span>
        </div>
        {thumbPath ? (
          <AssetImage
            storyName={storyName}
            assetPath={thumbPath}
            authFetch={authFetch}
            alt={`Cut ${cut.id} artwork`}
            className="w-full max-h-[32rem] object-contain rounded border border-border bg-white"
          />
        ) : (
          <div className="w-full min-h-28 rounded border border-dashed border-border bg-surface/40 flex items-center justify-center text-[10px] text-muted" data-testid={`cut-card-noart-${cut.id}`}>
            {isTextPanel(cut) ? "Text panel — no artwork needed" : "No artwork yet"}
          </div>
        )}
        <div
          className={`rounded border border-border/70 bg-surface/50 px-2 py-1.5 text-[11px] ${BOARD_TONE_TEXT[reviewState.tone]}`}
          data-testid={`lettering-review-state-${cut.id}`}
        >
          <span className="font-semibold">{reviewState.label}</span>
          <span className="text-muted"> · {reviewState.detail}</span>
        </div>
        <button
          onClick={onToggle}
          data-testid={`cut-desc-${cut.id}`}
          className="block w-full text-left text-[11px] text-muted hover:text-foreground"
        >
          {cut.description || "No description"}
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          {atLetteringStage ? (
            <button
              onClick={onOpenEditor}
              data-testid={`add-bubbles-${cut.id}`}
              className="px-2.5 py-1 text-[11px] font-medium rounded bg-accent text-white hover:bg-accent-dim"
            >
              {bubblesPlaced > 0 ? "Review lettering" : "Open focused editor"}
            </button>
          ) : primary ? (
            <button
              onClick={primary.onClick}
              disabled={board.key === "convert" && (convertingThis || converting)}
              data-testid={primary.testid}
              className="px-2.5 py-1 text-[11px] font-medium rounded bg-accent text-white hover:bg-accent-dim disabled:opacity-50"
            >
              {primary.label}
            </button>
          ) : null}
          <button
            onClick={onToggle}
            data-testid={`cut-details-${cut.id}`}
            className="px-2.5 py-1 text-[11px] rounded border border-border text-muted hover:border-accent hover:text-accent"
          >
            {expanded ? "Hide details" : "Open details"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border">
          {/* Stale recorded asset path (#302): the cut records a clean/final image
              path but the file is missing/invalid. Show the precise reason and a
              repair action that clears the stale clean AND final fields back to
              null (valid paths and uploaded URLs are preserved). */}
          {/* PNG clean image awaiting conversion (#441): offer the conversion
              rather than the stale-path "Clear" repair (which would discard the
              draft art). The raw unsupported-extension reason stays hidden in the
              Convert artwork banner's technical details. */}
          {needsConversion && (
            <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 space-y-1" data-testid={`needs-conversion-${cut.id}`}>
              <p className="text-[11px] text-amber-800">
                This cut’s artwork is a PNG. Convert it to WebP so it can be lettered and published.
              </p>
              <button
                onClick={handleConvertThis}
                disabled={convertingThis || converting}
                data-testid={`convert-cut-${cut.id}`}
                className="px-2 py-1 text-[11px] border border-amber-500/50 text-amber-800 rounded hover:bg-amber-500/20 disabled:opacity-50"
              >
                {convertingThis ? "Converting…" : "Convert image"}
              </button>
            </div>
          )}
          {hasStale && !needsConversion && (
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

          {/* The clean/artwork thumbnail now lives in the always-visible card
              head (#440); Details holds the technical controls below. */}

          {/* Clean image: copy generation prompt + upload the generated file.
              Text/interstitial panels need no clean image (#351), so this whole
              generation/upload handoff is image-cut only. */}
          {!isTextPanel(cut) && (
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
              {/* #403: import a Codex-generated PNG straight from its cache, so a
                  writer never has to hunt through ~/.codex/generated_images in an
                  OS file dialog. Same in-browser PNG→WebP conversion + upload. */}
              <button
                onClick={() => setShowCodexPicker((v) => !v)}
                disabled={uploading}
                data-testid={`import-codex-${cut.id}`}
                className="px-3 py-1.5 text-xs border border-border rounded hover:border-accent hover:bg-accent/5 disabled:opacity-50"
              >
                {showCodexPicker ? "Hide Codex images" : "Import from Codex"}
              </button>
            </div>
            {showCodexPicker && (
              <CodexImportPicker
                authFetch={authFetch}
                cutId={cut.id}
                onImport={async (file) => {
                  const ok = await handleUpload(file);
                  if (ok) setShowCodexPicker(false);
                }}
                onClose={() => setShowCodexPicker(false)}
              />
            )}
            {!cut.cleanImagePath && (
              <p className="text-xs text-muted" data-testid={`clean-image-handoff-${cut.id}`}>
                Generate this cut in Codex, then import the cached PNG with &ldquo;Import from Codex&rdquo; — or
                upload an image manually. Letter it next.
              </p>
            )}
            {status === "missing" && (
              <div
                className="rounded border border-border bg-surface/60 p-2 space-y-1"
                data-testid={`ask-codex-${cut.id}`}
              >
                <p className="text-[11px] font-medium text-foreground">Generate this cut in Codex</p>
                <p className="text-[10px] text-muted">
                  Copy the task below and paste it into Codex. Codex usually saves a PNG to its
                  image cache — bring it into this cut with &ldquo;Import from Codex&rdquo; above (the PNG
                  becomes a WebP automatically). If Codex instead writes a WebP/JPEG at{" "}
                  <span className="font-mono">assets/{plotFile}/cut-{String(cut.id).padStart(2, "0")}-clean.webp</span>,
                  it&rsquo;s picked up by &ldquo;Sync clean images&rdquo;.
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
          )}

          {/* Open editor — image cuts, narration cuts, and text panels (#351) */}
          {(cut.cleanImagePath || cut.narration || cut.dialogue.length > 0 || isTextPanel(cut)) && (
            <button
              onClick={onOpenEditor}
              data-testid={`open-editor-${cut.id}`}
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

export function CutListPanel({ storyName, fileName, authFetch, language, uploadRetry, onCutsChanged, focusRequest, onFocusHandled }: CutListPanelProps) {
  const [cutsFile, setCutsFile] = useState<CutsFile | null>(null);
  // Latest onCutsChanged in a ref so loadCuts can notify the parent without
  // taking the callback as a dependency (which would churn loadCuts/effects).
  const onCutsChangedRef = useRef(onCutsChanged);
  onCutsChangedRef.current = onCutsChanged;
  const onFocusHandledRef = useRef(onFocusHandled);
  onFocusHandledRef.current = onFocusHandled;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCut, setExpandedCut] = useState<number | null>(null);
  const [editingCutId, setEditingCutId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genWarnings, setGenWarnings] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  // Episode publish markdown + on-chain state, for the guided Finish panel (#414):
  // distinguishes uploaded-but-not-prepared from a prepared/ready-to-publish or
  // already-published episode (which cuts.json alone cannot tell apart).
  const [episodeState, setEpisodeState] = useState<{ markdownReady: boolean; published: boolean }>({
    markdownReady: false,
    published: false,
  });
  const [syncing, setSyncing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [detected, setDetected] = useState<Set<number>>(new Set());
  // cutId → precise stale-path messages (#302), from detect-clean-images.
  const [staleByCut, setStaleByCut] = useState<Map<number, string[]>>(new Map());
  // True only after /detect-clean-images has SUCCESSFULLY verified the recorded
  // paths against disk (#311). Gates the "clean-assets-ready" banner so it never
  // claims completion from unverified cut-plan fields while detection is pending
  // or after it failed.
  const [detectConfirmed, setDetectConfirmed] = useState(false);
  // Read-only per-cut asset diagnostics validated against disk (#427): the real
  // state (planned/missing/clean-ready/final-ready/uploaded) + precise issues.
  const [assetDiagnostics, setAssetDiagnostics] = useState<CutAssetDiagnostic[] | null>(null);
  const [rescanning, setRescanning] = useState(false);
  // #371: cut whose row should be scrolled into view after a Preview→Edit deep
  // link. Applied once its row has rendered (see the scroll effect below).
  const [scrollTargetCutId, setScrollTargetCutId] = useState<number | null>(null);
  // Live DOM refs for cut rows, keyed by cut id, used to scroll a focused cut
  // into view. A ref map avoids re-rendering on registration.
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Guards against re-applying the same focus request twice within one mount.
  const appliedFocusSeq = useRef<number | null>(null);

  const plotFile = fileName.replace(/\.md$/, "");

  // Apply a Preview / Cut Inspector deep-link (#371): open the lettering editor
  // for the cut, or expand + scroll its row when there is nothing to letter yet.
  // The chosen expandedCut/editingCutId state persists until the rows render
  // (cuts load asynchronously), so this does not need the cut plan loaded first.
  useEffect(() => {
    if (!focusRequest) return;
    if (appliedFocusSeq.current === focusRequest.seq) return;
    appliedFocusSeq.current = focusRequest.seq;
    if (focusRequest.openEditor) {
      setEditingCutId(focusRequest.cutId);
    } else {
      setExpandedCut(focusRequest.cutId);
      setScrollTargetCutId(focusRequest.cutId);
    }
    onFocusHandledRef.current?.();
  }, [focusRequest]);

  // Scroll a deep-linked, expanded cut into view once its row is on screen. Runs
  // when the target is set and again after the cut plan loads (rows mount). Best
  // effort: `scrollIntoView` is a no-op/undefined under jsdom.
  useEffect(() => {
    if (scrollTargetCutId == null) return;
    const el = rowRefs.current.get(scrollTargetCutId);
    if (!el) return;
    el.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setScrollTargetCutId(null);
  }, [scrollTargetCutId, cutsFile]);

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
      const parsed = await res.json();
      setCutsFile(parsed);
      setError(null);
      // Read the episode's publish markdown + on-chain status so the Finish panel
      // can show "Episode sequence prepared" / "Ready to publish" / "Published"
      // distinctly, not just upload progress (#414). Best-effort — a missing file
      // or error simply leaves those steps as not-yet-prepared.
      try {
        const fileRes = await authFetch(`/api/stories/${storyName}/${fileName}`);
        if (fileRes.ok) {
          const fd = await fileRes.json();
          const content: string = typeof fd?.content === "string" ? fd.content : "";
          const cuts = Array.isArray(parsed?.cuts) ? parsed.cuts : [];
          const markdownReady = content.length > 0 && checkMarkdownReadiness(content, cuts).ready;
          const published = fd?.status === "published" || fd?.status === "published-not-indexed";
          setEpisodeState({ markdownReady, published });
        } else {
          setEpisodeState({ markdownReady: false, published: false });
        }
      } catch {
        setEpisodeState({ markdownReady: false, published: false });
      }
      // Tell the parent the cut plan changed so its readiness/Episode-steps view
      // refreshes in lockstep (e.g. after a lettering export, #343).
      onCutsChangedRef.current?.();
    } catch {
      setError("Failed to load cuts");
    } finally {
      setLoading(false);
    }
  }, [authFetch, storyName, plotFile, fileName]);

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

  // Read-only per-cut asset state validated against disk (#427). Best-effort.
  // Clear the prior plan's diagnostics in EVERY exit path (start, non-OK, catch)
  // so a stale missing-path banner can never persist under a different cut plan
  // when the new request fails/404s on a story/file switch (@re1).
  const loadDiagnostics = useCallback(async () => {
    setAssetDiagnostics(null);
    try {
      const res = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}/asset-diagnostics`);
      if (!res.ok) return; // stays cleared
      const data = await res.json();
      setAssetDiagnostics(Array.isArray(data.diagnostics) ? data.diagnostics : null);
    } catch { /* stays cleared — diagnostics are optional */ }
  }, [authFetch, storyName, plotFile]);

  // "Refresh assets / Check generated images" (#427): a read-only rescan that
  // re-reads the cut plan, re-detects local clean files, and re-classifies each
  // cut's asset state against disk — so a writer can notice agent-generated images
  // without restarting. Never mutates, uploads, or publishes (unlike Sync).
  const refreshAssets = useCallback(async () => {
    setRescanning(true);
    try {
      await Promise.all([loadCuts(), loadDetect(), loadDiagnostics()]);
    } finally {
      setRescanning(false);
    }
  }, [loadCuts, loadDetect, loadDiagnostics]);

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
        await loadDiagnostics();
      }
    } catch {
      setSyncResult("Sync failed");
    }
    setSyncing(false);
  }, [authFetch, storyName, plotFile, loadCuts, loadDetect, loadDiagnostics]);

  // Convert one cut's PNG clean image to a publishable WebP/JPEG (#441): fetch
  // the PNG asset, convert + compress it in the browser (same path as a manual
  // upload), and persist via the existing upload-clean route, which records the
  // new cleanImagePath. Returns true on success. Publish stays strict — the route
  // only accepts WebP/JPEG ≤1MB, so conversion is the safe bridge from a draft PNG.
  const convertCut = useCallback(async (cutId: number, pngPath: string): Promise<boolean> => {
    try {
      const res = await authFetch(assetUrl(storyName, pngPath));
      if (!res.ok) return false;
      const blob = await res.blob();
      const compliant = await importImageToCompliantBlob(new File([blob], "clean.png", { type: blob.type || "image/png" }));
      const ext = compliant.type === "image/jpeg" ? "jpg" : "webp";
      const formData = new FormData();
      formData.append("file", new File([compliant], `clean.${ext}`, { type: compliant.type }));
      const up = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}/upload-clean/${cutId}`, { method: "POST", body: formData });
      return up.ok;
    } catch {
      return false;
    }
  }, [authFetch, storyName, plotFile]);

  // "Convert all artwork" (#441): batch-convert every cut flagged needs-conversion.
  const convertAll = useCallback(async (jobs: { cutId: number; pngPath: string }[]) => {
    setConverting(true);
    setConvertResult(null);
    let done = 0;
    const failed: number[] = [];
    for (const job of jobs) {
      // Sequential on purpose: avoid hammering browser canvas conversion + the
      // upload-clean write all at once for a 10-cut episode.
      const ok = await convertCut(job.cutId, job.pngPath);
      if (ok) done++; else failed.push(job.cutId);
    }
    await refreshAssets();
    setConverting(false);
    setConvertResult(
      failed.length === 0
        ? `Converted ${done} image${done === 1 ? "" : "s"} to WebP`
        : `Converted ${done}; ${failed.length} failed (Cut ${failed.join(", ")}) — try Convert image on each`,
    );
  }, [convertCut, refreshAssets]);

  // Guided "Finish episode" orchestration (#414): upload every exported final
  // image (paced under the rate limit, #413/#288), then prepare the publish
  // markdown — in order, resumable (already-uploaded cuts are skipped by the
  // `!uploadedCid` filter). Surfaced as the primary "Finish episode" action and
  // reused by the lower-level "Upload & Prepare for Publish" control.
  const finishEpisode = useCallback(async () => {
    if (!cutsFile) return;
    setUploading(true);
    setUploadProgress("");
    setGenWarnings([]);
    const toUpload = cutsFile.cuts.filter((ct) => ct.finalImagePath && !ct.uploadedCid);
    const errors: string[] = [];
    // Proactively pace uploads under PlotLink's 5/min limit so a 7–10 cut episode
    // completes without manual waiting, instead of firing all at once and thrashing
    // on reactive 429 backoff (#413). Reuses the same injectable sleep as the retry
    // path so tests stay deterministic.
    const throttle = createUploadThrottle({
      sleep: uploadRetry?.sleep,
      onWaiting: ({ waitMs }) =>
        setUploadProgress(
          `Upload limit reached — waiting ${Math.round(waitMs / 1000)}s before continuing…`,
        ),
    });
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
        // Proactively wait if we've already used the 5/min budget (#413), then retry
        // with backoff while the PlotLink endpoint rate-limits us anyway (5
        // uploads/min), instead of failing the whole batch (#288). Already-uploaded
        // cuts are skipped by the `!uploadedCid` filter above, so a retry never
        // re-uploads a recorded cut.
        await throttle();
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
    setUploadProgress("Preparing episode for publishing…");
    const mdRes = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}/generate-markdown`, { method: "POST" });
    if (mdRes.ok) {
      const data = await mdRes.json();
      if (data.warnings?.length > 0) setGenWarnings(data.warnings);
    }
    setUploading(false);
    setUploadProgress("");
    loadCuts();
  }, [cutsFile, authFetch, storyName, plotFile, uploadRetry, loadCuts]);

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

  // Insert a text/interstitial panel to the cut plan (#352/#488) — a one-click way
  // to add a narration/title card between image cuts without hand-editing cuts.json.
  const [addingPanel, setAddingPanel] = useState(false);
  const addTextPanelAt = useCallback(async (insertIndex: number, openEditor = true) => {
    if (!cutsFile) return;
    setAddingPanel(true);
    try {
      const nextId = cutsFile.cuts.reduce((m, c) => Math.max(m, c.id), 0) + 1;
      const panel = {
        id: nextId, shotType: "wide", description: "Text panel", characters: [],
        dialogue: [], narration: "", sfx: "",
        cleanImagePath: null, finalImagePath: null, exportedAt: null,
        uploadedCid: null, uploadedUrl: null, overlays: [],
        kind: "text" as const, background: "#101820", aspectRatio: "4:5",
      };
      const nextCuts = [...cutsFile.cuts];
      nextCuts.splice(Math.max(0, Math.min(insertIndex, nextCuts.length)), 0, panel);
      const updated = { ...cutsFile, cuts: nextCuts };
      const res = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        if (openEditor) setEditingCutId(nextId);
        else setExpandedCut(nextId);
        await loadCuts();
      } else {
        const data = await res.json().catch(() => ({}));
        setSyncResult(data.error || "Could not add text panel");
      }
    } catch {
      setSyncResult("Could not add text panel");
    }
    setAddingPanel(false);
  }, [cutsFile, authFetch, storyName, plotFile, loadCuts]);
  const addTextPanel = useCallback(() => addTextPanelAt(cutsFile?.cuts.length ?? 0, true), [addTextPanelAt, cutsFile]);

  useEffect(() => {
    loadCuts();
    loadDetect();
    loadDiagnostics();
  }, [loadCuts, loadDetect, loadDiagnostics]);

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
        targetLabel={isTextPanel(editingCut) ? `Between-scene card ${editingCut.id}` : `Cut ${String(editingCut.id).padStart(2, "0")}`}
        returnOnSave
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
    { missing: 0, clean: 0, lettered: 0, uploaded: 0, text: 0 } as Record<CutStatus, number>,
  );
  // Text/interstitial panels need no clean image (#351), so the clean-assets
  // banner/claims reason about IMAGE cuts only — never the total cut count.
  const imageCutCount = cutsFile.cuts.filter((c) => !isTextPanel(c)).length;
  // #381: final images lettered by an older bubble renderer (separate-tail seam)
  // must be re-exported before publish. Only tailed speech bubbles are affected.
  const staleTailIds = cutsFile.cuts.filter((c) => isStaleTailedExport(c)).map((c) => c.id);

  // Guided "Finish episode" state (#414). The checklist's publish step reflects the
  // real on-chain status; markdownReady distinguishes uploaded-but-not-prepared from
  // a prepared/ready-to-publish episode. canFinish = something the Finish action can
  // still do: a final to upload, or uploads done but the sequence not yet prepared.
  const finishChecklist = cartoonChecklist({ cuts: cutsFile.cuts, published: episodeState.published });
  const uploadStepDone = finishChecklist.steps.find((s) => s.key === "upload")?.status === "done";
  const canFinish =
    cutsFile.cuts.some((ct) => ct.finalImagePath && !ct.uploadedCid) ||
    (uploadStepDone && !episodeState.markdownReady);

  // PNG clean images awaiting conversion (#441): a friendly, batch-able step, not
  // a red unsupported-extension dump. Built from the disk-validated diagnostics.
  const conversionJobs = (assetDiagnostics ?? [])
    .filter((d) => d.state === "needs-conversion" && d.convertiblePng)
    .map((d) => ({ cutId: d.cutId, pngPath: d.convertiblePng as string }));
  const conversionByCut = new Map(conversionJobs.map((j) => [j.cutId, j.pngPath]));
  const conversionIssues = (assetDiagnostics ?? [])
    .filter((d) => d.state === "needs-conversion" && d.issue)
    .map((d) => d.issue as string);

  // Creator-facing episode header + progress summary (#440). Counts the human
  // milestones, not internal fields: artwork found (any clean image incl. a draft
  // PNG), converted (publishable WebP/JPEG), lettered (bubbles placed/exported),
  // uploaded. PNG-only cuts read as "artwork found" but not yet "converted".
  const episodeLabel = fileName === "genesis.md"
    ? "Genesis / Episode 1"
    : `Episode ${parseInt(plotFile.match(/\d+/)?.[0] ?? "0", 10) + 1}`;
  const episodeTitle = typeof (cutsFile as { title?: unknown }).title === "string" ? (cutsFile as { title?: string }).title : null;
  const imageCuts = cutsFile.cuts.filter((c) => !isTextPanel(c));
  const boardSummary = {
    cuts: cutsFile.cuts.length,
    artwork: imageCuts.filter((c) => c.cleanImagePath || conversionByCut.has(c.id)).length,
    converted: imageCuts.filter((c) => c.cleanImagePath && /\.(webp|jpe?g)$/i.test(c.cleanImagePath)).length,
    lettered: cutsFile.cuts.filter((c) => (c.overlays?.length ?? 0) > 0 || !!c.finalImagePath).length,
    uploaded: cutsFile.cuts.filter((c) => c.uploadedCid || c.uploadedUrl).length,
  };

  return (
    <div className="h-full min-h-[22rem] flex flex-col overflow-hidden" data-testid="cut-list-panel">
      {/* Episode header + creator-facing progress summary (#440). */}
      <div className="px-3 py-2 border-b border-border flex-shrink-0" data-testid="cut-board-header">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-serif text-foreground truncate">{episodeLabel}</span>
          {episodeTitle && <span className="text-muted truncate">· {episodeTitle}</span>}
        </div>
        <div className="mt-0.5 text-[10px] text-muted" data-testid="cut-board-summary">
          {boardSummary.cuts} cuts · {boardSummary.artwork} artwork found · {boardSummary.converted} converted · {boardSummary.lettered} lettered · {boardSummary.uploaded} uploaded
        </div>
      </div>
      {/* Lower-level / manual controls, collapsed by default so the board stays
          focused on per-cut actions (#440). The guided Finish flow + per-cut
          primary actions are the main path; these stay for power users. */}
      <details className="border-b border-border flex-shrink-0" data-testid="cut-advanced">
      <summary className="px-3 py-1.5 text-[10px] text-muted cursor-pointer hover:text-foreground">Technical details</summary>
      <div className="px-3 py-2 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="font-mono text-muted">{cutsFile.cuts.length} cuts</span>
        {stats.missing > 0 && <span className="text-muted">{stats.missing} missing</span>}
        {stats.clean > 0 && <span className="text-green-700">{stats.clean} clean</span>}
        {stats.lettered > 0 && <span className="text-amber-700">{stats.lettered} lettered</span>}
        {stats.uploaded > 0 && <span className="text-green-700">{stats.uploaded} uploaded</span>}
        {stats.text > 0 && <span className="text-accent">{stats.text} text {stats.text === 1 ? "panel" : "panels"}</span>}
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
          onClick={addTextPanel}
          disabled={addingPanel}
          className="px-2 py-0.5 border border-accent/30 text-accent rounded hover:bg-accent/5 disabled:opacity-50"
          data-testid="add-text-panel-btn"
          title="Insert a narration/title card between art panels — a solid card exported as a final image panel, no drawing needed"
        >
          {addingPanel ? "Adding…" : "Add narration/text panel"}
        </button>
        <button
          onClick={refreshAssets}
          disabled={rescanning}
          className="px-2 py-0.5 border border-border text-muted rounded hover:border-accent hover:text-accent disabled:opacity-50"
          data-testid="refresh-assets-btn"
          title="Re-check the story folder for agent-generated images and report each cut's asset state — read only, nothing is uploaded or published"
        >
          {rescanning ? "Checking…" : "Refresh assets"}
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
          onClick={finishEpisode}
          disabled={uploading || !cutsFile?.cuts.some((ct) => ct.finalImagePath && !ct.uploadedCid)}
          className="px-2 py-0.5 border border-accent/30 text-accent rounded hover:bg-accent/5 disabled:opacity-50"
          data-testid="upload-generate-btn"
          title="Upload each cut's final lettered image, then prepare the episode for publishing"
        >
          {uploadProgress || "Upload & Prepare for Publish"}
        </button>
      </div>
      </details>
      {/* Plain-language workflow + text-panel explainer (#360) so a non-technical
          writer understands the order of operations and what a text panel is. */}
      <details
        className="px-3 py-1.5 border-b border-border bg-surface/40 flex-shrink-0"
        data-testid="cartoon-workflow-help"
      >
        <summary className="cursor-pointer select-none text-[10px] text-muted hover:text-foreground">
          Cut workflow help
        </summary>
        <div className="mt-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-foreground">1. Letter</span>
            <span aria-hidden>→</span>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-foreground">2. Export</span>
            <span aria-hidden>→</span>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-foreground">3. Upload</span>
            <span aria-hidden>→</span>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-foreground">4. Prepare episode for publish</span>
          </div>
          <div className="mt-1 text-[10px] text-muted">
            Use <span className="text-accent">Add narration/text panel</span> for a narration or title card. It becomes a solid card exported as a final image.
          </div>
        </div>
      </details>
      {/* Stale bubble-renderer warning (#381): a final image lettered before the
          current seamless-tail renderer may show the old separate-tail seam.
          Mark those cuts so the writer re-exports (open lettering → Export) and
          re-uploads them before publishing. */}
      {staleTailIds.length > 0 && (
        <div
          className="px-3 py-1.5 border-b border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 flex-shrink-0"
          data-testid="stale-bubble-export-warning"
        >
          {staleTailIds.length === 1 ? "Cut" : "Cuts"} {staleTailIds.join(", ")} {staleTailIds.length === 1 ? "was" : "were"} lettered with an older speech-bubble style whose tail can show a visible seam. Re-export {staleTailIds.length === 1 ? "it" : "them"} (open lettering → Export) and re-upload before publishing so the bubble tails are seamless.
        </div>
      )}
      {/* Clean-asset generation done-state (#311): when every cut has a present,
          valid clean image, surface a clear "done" signal so the operator knows
          Codex generation is complete even if the terminal session is still
          connected — no more guessing whether it is still Working. */}
      {detectConfirmed && imageCutCount > 0 && stats.missing === 0 && staleByCut.size === 0 && (
        <div className="px-3 py-1 border-b border-border bg-green-600/10 text-[10px] text-green-700 flex items-center gap-1 flex-shrink-0" data-testid="clean-assets-ready">
          <span aria-hidden>✓</span>
          <span>
            All {imageCutCount} clean image{imageCutCount === 1 ? "" : "s"} present — clean-asset generation is complete. Ready for lettering in OWS.
          </span>
        </div>
      )}
      {syncResult && (
        <div className="px-3 py-1 border-b border-border text-[10px] text-muted flex-shrink-0" data-testid="sync-result">
          {syncResult}
        </div>
      )}
      {/* Convert artwork step (#441, spec §8): PNG clean images are a normal
          drafting intermediate, surfaced as a friendly batch conversion rather
          than red "Unsupported extension" errors. The raw reasons stay available
          under a collapsed "Technical details" disclosure. */}
      {conversionJobs.length > 0 && (
        <div className="px-3 py-2 border-b border-amber-500/40 bg-amber-500/10 text-[11px] flex-shrink-0" data-testid="convert-artwork">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-amber-700" data-testid="convert-artwork-count">
              {conversionJobs.length} PNG image{conversionJobs.length === 1 ? "" : "s"} found
            </span>
            <button
              onClick={() => convertAll(conversionJobs)}
              disabled={converting}
              data-testid="convert-all-btn"
              className="ml-auto px-2 py-0.5 border border-amber-500/50 text-amber-800 rounded hover:bg-amber-500/20 disabled:opacity-50"
            >
              {converting ? "Converting…" : "Convert all to WebP"}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-muted">
            PNG artwork is fine while drafting. Convert it before lettering/export so PlotLink can publish it safely.
          </p>
          {convertResult && <p className="mt-1 text-[10px] text-muted" data-testid="convert-result">{convertResult}</p>}
          {conversionIssues.length > 0 && (
            <details className="mt-1" data-testid="convert-technical-details">
              <summary className="text-[10px] text-muted cursor-pointer">Technical details</summary>
              <ul className="mt-1 ml-3 list-disc text-[10px] text-muted">
                {conversionIssues.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
      {/* Read-only per-cut asset state validated against disk (#427): a compact
          state tally + a precise per-cut reason when a recorded path is broken,
          so "files exist but aren't shown" / a typoed path is a clear diagnostic
          rather than a generic publish warning. */}
      {assetDiagnostics && assetDiagnostics.length > 0 && (() => {
        const s = summarizeAssetDiagnostics(assetDiagnostics);
        const missing = assetDiagnostics.filter((d) => d.state === "missing");
        return (
          <div className="px-3 py-1.5 border-b border-border bg-surface/40 text-[10px] flex-shrink-0" data-testid="asset-diagnostics">
            <span className="text-muted" data-testid="asset-diag-summary">
              Assets: {s.uploaded} uploaded · {s.finalReady} final · {s.cleanReady} clean · {s.planned} planned{s.needsConversion > 0 ? ` · ${s.needsConversion} needs conversion` : ""}{s.missing > 0 ? ` · ${s.missing} missing` : ""}
            </span>
            {missing.length > 0 && (
              <ul className="mt-1 ml-3 list-disc text-error" data-testid="asset-diag-issues">
                {missing.map((d) => <li key={d.cutId}>{d.issue}</li>)}
              </ul>
            )}
          </div>
        );
      })()}
      {/* Guided Finish-episode flow (#414): writer-language step status, one primary
          "Finish episode" action that uploads finals then prepares the publish
          markdown in order, and any blockers grouped by the step that fixes them —
          replacing the old flat amber warning list. The lower-level controls in the
          header above stay available for manual recovery. */}
      <FinishEpisodePanel
        checklist={finishChecklist}
        issues={genWarnings}
        onFinish={finishEpisode}
        finishing={uploading}
        progressText={uploadProgress}
        canFinish={canFinish}
        markdownReady={episodeState.markdownReady}
        published={episodeState.published}
      />

      {/* Full cut review (#488): all clean cuts are shown vertically first, with
          explicit between-scene slots for narration/title cards. */}
      <div className="flex-1 min-h-56 overflow-y-auto p-3 space-y-3" data-testid="lettering-review-board">
        {cutsFile.cuts.map((cut, index) => (
          <Fragment key={cut.id}>
            <BetweenSceneSlot
              index={index}
              beforeLabel={index === 0 ? "Episode opening" : `After cut ${cutsFile.cuts[index - 1]?.id}`}
              afterLabel={`Before cut ${cut.id}`}
              disabled={addingPanel}
              onAdd={() => addTextPanelAt(index)}
            />
            <CutRow
              cut={cut}
              storyName={storyName}
              plotFile={plotFile}
              expanded={expandedCut === cut.id}
              onToggle={() => setExpandedCut(expandedCut === cut.id ? null : cut.id)}
              authFetch={authFetch}
              onUpdated={() => { loadCuts(); loadDetect(); loadDiagnostics(); }}
              onOpenEditor={() => setEditingCutId(cut.id)}
              detectedLocalClean={detected.has(cut.id)}
              onSyncClean={syncCleanImages}
              syncing={syncing}
              staleMessages={staleByCut.get(cut.id) ?? []}
              onRepairStale={repairStalePaths}
              repairing={repairing}
              conversionPng={conversionByCut.get(cut.id) ?? null}
              onConvert={convertCut}
              converting={converting}
              rowRef={(el) => { if (el) rowRefs.current.set(cut.id, el); else rowRefs.current.delete(cut.id); }}
            />
          </Fragment>
        ))}
        <BetweenSceneSlot
          index={cutsFile.cuts.length}
          beforeLabel={`After cut ${cutsFile.cuts[cutsFile.cuts.length - 1]?.id}`}
          afterLabel="Episode ending"
          disabled={addingPanel}
          onAdd={() => addTextPanelAt(cutsFile.cuts.length)}
        />
      </div>
    </div>
  );
}

function BetweenSceneSlot({
  index,
  beforeLabel,
  afterLabel,
  disabled,
  onAdd,
}: {
  index: number;
  beforeLabel: string;
  afterLabel: string;
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <div
      className="rounded border border-dashed border-border bg-surface/35 px-3 py-2 text-[11px] text-muted flex items-center gap-3"
      data-testid={`between-scene-slot-${index}`}
    >
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground">Between-scene lettering</span>
        <span className="block truncate">{beforeLabel} · {afterLabel}</span>
      </span>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="flex-shrink-0 rounded border border-accent/40 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/5 disabled:opacity-50"
        data-testid={`add-between-scene-${index}`}
      >
        Add card
      </button>
    </div>
  );
}
