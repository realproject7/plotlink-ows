import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { GENRES } from "../../../lib/genres";

interface PreviewPanelProps {
  storyName: string | null;
  fileName: string | null;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  onPublish?: (storyName: string, fileName: string, genre: string) => void;
  publishingFile?: string | null;
}

interface FileData {
  file: string;
  status: "published" | "published-not-indexed" | "pending" | "draft";
  content: string;
  txHash?: string;
  storylineId?: number;
  plotIndex?: number;
  indexError?: string;
  publishedAt?: string;
}

type Tab = "preview" | "edit";

export function PreviewPanel({ storyName, fileName, authFetch, onPublish, publishingFile }: PreviewPanelProps) {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("preview");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [indexTimeLeft, setIndexTimeLeft] = useState<number | null>(null);
  const [selectedGenre, setSelectedGenre] = useState(GENRES[0]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirtyRef = useRef(false);

  const prevFileRef = useRef<string | null>(null);

  const loadFile = useCallback(async () => {
    if (!storyName || !fileName) { setFileData(null); return; }
    const fileKey = `${storyName}/${fileName}`;
    const isNewFile = prevFileRef.current !== fileKey;
    if (isNewFile) {
      prevFileRef.current = fileKey;
    }
    try {
      const res = await authFetch(`/api/stories/${storyName}/${fileName}`);
      if (res.ok) {
        const data: FileData = await res.json();
        setFileData(data);
        // Update edit content on new file or when no unsaved changes
        if (isNewFile || !dirtyRef.current) {
          setEditContent(data.content ?? "");
          if (isNewFile) { setDirty(false); dirtyRef.current = false; }
        }
      }
    } catch { /* ignore */ }
  }, [storyName, fileName, authFetch]);

  // Initial load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    setLoading(true);
    loadFile().finally(() => setLoading(false));
  }, [loadFile]);

  // Auto-refresh every 3 seconds (only in preview mode when not dirty)
  useEffect(() => {
    if (!storyName || !fileName) return;
    if (activeTab === "edit" && dirty) return;
    const interval = setInterval(loadFile, 3000);
    return () => clearInterval(interval);
  }, [storyName, fileName, loadFile, activeTab, dirty]);

  // Auto-detect genre from structure.md when story changes
  useEffect(() => {
    if (!storyName) return;
    let cancelled = false;
    authFetch(`/api/stories/${storyName}/structure.md`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled || !data?.content) return;
        const match = data.content.match(/\*{0,2}genre\*{0,2}[:\s]+(.+)/i);
        if (match) {
          const detected = match[1].replace(/\*+/g, "").trim();
          const found = GENRES.find((g) => g.toLowerCase() === detected.toLowerCase());
          if (found) setSelectedGenre(found);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [storyName, authFetch]);

  const handleSave = useCallback(async () => {
    if (!storyName || !fileName) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/stories/${storyName}/${fileName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        setDirty(false); dirtyRef.current = false;
        setFileData((prev) => prev ? { ...prev, content: editContent } : prev);
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [storyName, fileName, authFetch, editContent]);

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    if (activeTab !== "edit") return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, handleSave]);

  // 5-minute countdown for Retry Index button
  useEffect(() => {
    if (fileData?.status !== "published-not-indexed" || !fileData.publishedAt) {
      return;
    }
    const publishedAt = new Date(fileData.publishedAt).getTime();
    const windowMs = 5 * 60 * 1000;
    const update = () => {
      const remaining = Math.max(0, windowMs - (Date.now() - publishedAt));
      setIndexTimeLeft(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [fileData?.status, fileData?.publishedAt]);

  const indexExpired = indexTimeLeft !== null && indexTimeLeft <= 0;
  const indexCountdown = indexTimeLeft !== null && indexTimeLeft > 0
    ? `${Math.floor(indexTimeLeft / 60000)}:${String(Math.floor((indexTimeLeft % 60000) / 1000)).padStart(2, "0")}`
    : null;

  if (!storyName || !fileName) {
    return (
      <div className="h-full flex items-center justify-center text-muted">
        <div className="text-center">
          <p className="text-lg font-serif">Select a file to preview</p>
          <p className="text-sm mt-1">Click a story file in the sidebar</p>
        </div>
      </div>
    );
  }

  if (loading && !fileData) {
    return (
      <div className="h-full flex items-center justify-center text-muted">
        Loading...
      </div>
    );
  }

  const content = activeTab === "edit" ? editContent : (fileData?.content ?? "");
  const charCount = content.length;
  const isGenesis = fileName === "genesis.md";
  const isPlot = fileName ? /^plot-\d+\.md$/.test(fileName) : false;
  const isPublished = fileData?.status === "published" || fileData?.status === "published-not-indexed";
  const charLimit = (isGenesis || isPlot) ? 10000 : null;
  // Don't show over-limit warning for already-published files
  const overLimit = !isPublished && charLimit !== null && charCount > charLimit;

  return (
    <div className="h-full flex flex-col">
      {/* Header with file path + tabs */}
      <div className="border-b border-border">
        <div className="px-3 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono text-muted">
            <span>{storyName}/{fileName}</span>
            {fileData?.status === "published" && (
              <span className="text-green-700 font-medium">Published</span>
            )}
            {fileData?.status === "published-not-indexed" && (
              <span className="text-amber-700 font-medium" title={fileData.indexError}>Published (not indexed)</span>
            )}
            {fileData?.status === "pending" && (
              <span className="text-amber-700 font-medium">Pending</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono ${overLimit ? "text-error font-medium" : "text-muted"}`}>
              {charCount.toLocaleString()}{charLimit !== null ? `/${charLimit.toLocaleString()}` : " chars"}
            </span>
            {overLimit && (
              <span className="text-error text-xs font-medium">
                {(charCount - charLimit).toLocaleString()} over limit
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-3 gap-1">
          <button
            onClick={() => setActiveTab("preview")}
            className={`px-3 py-1 text-xs font-medium border-b-2 transition-colors ${
              activeTab === "preview"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Preview
          </button>
          <button
            onClick={() => setActiveTab("edit")}
            className={`px-3 py-1 text-xs font-medium border-b-2 transition-colors ${
              activeTab === "edit"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Edit
            {dirty && <span className="ml-1 text-amber-600">*</span>}
          </button>
        </div>
      </div>

      {/* Content area */}
      {activeTab === "preview" ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4" style={{ background: "var(--paper-bg)" }}>
          {fileData?.content ? (
            <div className="prose max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkBreaks, remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
              >
                {fileData.content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-muted italic">No content</p>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col" style={{ background: "var(--paper-bg)" }}>
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => { setEditContent(e.target.value); setDirty(true); dirtyRef.current = true; }}
            className="flex-1 min-h-0 w-full resize-none px-4 py-3 text-sm leading-relaxed focus:outline-none"
            style={{
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              background: "var(--paper-bg)",
              color: "var(--text)",
            }}
            spellCheck={false}
          />
          <div className="px-3 py-1.5 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted">
              {dirty ? "Unsaved changes" : "No changes"}
            </span>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-3 py-1 bg-accent text-white text-xs rounded hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="px-3 py-2 border-t border-border flex items-center justify-between">
        {fileName === "structure.md" ? (
          <p className="text-muted text-xs italic">This is your story outline — not publishable. Ask AI to write the genesis next.</p>
        ) : fileData?.status === "published-not-indexed" ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-amber-700">Published on-chain but not indexed on PlotLink</span>
              {!indexExpired && (
                <button
                  onClick={async () => {
                    if (!storyName || !fileName || !fileData.txHash) return;
                    setRetrying(true);
                    try {
                      const res = await authFetch("/api/publish/retry-index", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          storyName, fileName,
                          txHash: fileData.txHash,
                          content: fileData.content,
                          storylineId: fileData.storylineId,
                        }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        await authFetch(`/api/stories/${storyName}/${fileName}/publish-status`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            txHash: fileData.txHash,
                            storylineId: fileData.storylineId,
                            contentCid: "",
                            gasCost: "",
                          }),
                        });
                        loadFile();
                      }
                    } catch { /* ignore */ }
                    setRetrying(false);
                  }}
                  disabled={retrying}
                  className="px-3 py-1 bg-accent text-white text-xs rounded hover:bg-accent-dim disabled:opacity-50"
                >
                  {retrying ? "Retrying..." : `Retry Index${indexCountdown ? ` (${indexCountdown})` : ""}`}
                </button>
              )}
              {isPlot && (
                <button
                  onClick={() => storyName && fileName && onPublish?.(storyName, fileName, selectedGenre)}
                  disabled={!!publishingFile}
                  className="px-3 py-1 border border-border text-xs rounded hover:bg-surface disabled:opacity-50"
                >
                  {publishingFile === fileName ? "Publishing..." : "Retry Publish"}
                </button>
              )}
              {fileData.txHash && (
                <a
                  href={`https://basescan.org/tx/${fileData.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted underline"
                >
                  BaseScan
                </a>
              )}
            </div>
            <p className="text-muted text-xs">
              {indexExpired
                ? isPlot
                  ? "Index window expired. Use Retry Publish to create a new on-chain tx."
                  : "Index window expired. Contact support or re-publish manually."
                : isPlot
                  ? "Try Retry Index first (available for 5 min after publish). If that fails, Retry Publish creates a new on-chain tx."
                  : "Retry Index is available for 5 min after publish."}
            </p>
            {fileData.indexError && (
              <p className="text-error text-xs">{fileData.indexError}</p>
            )}
          </div>
        ) : fileData?.status === "published" ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-green-700">Published</span>
            {fileData.storylineId && (
              <a
                href={(() => {
                  const base = `https://plotlink.xyz/story/${fileData.storylineId}`;
                  if (!isPlot) return base;
                  // plotIndex convention: contract emits 0-based (genesis=0, plot-01=1)
                  // plotlink.xyz URLs use the same 0-based index
                  // Filename fallback: plot-01.md → parseInt("01") = 1 (matches contract)
                  const idx = fileData.plotIndex != null && fileData.plotIndex > 0
                    ? fileData.plotIndex
                    : parseInt(fileName?.match(/^plot-(\d+)\.md$/)?.[1] ?? "1");
                  return `${base}/${idx}`;
                })()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                View on PlotLink
              </a>
            )}
            {fileData.txHash && (
              <a
                href={`https://basescan.org/tx/${fileData.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted underline"
              >
                BaseScan
              </a>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {(isGenesis) && (
              <select
                value={selectedGenre}
                onChange={(e) => setSelectedGenre(e.target.value)}
                className="px-2 py-1.5 text-xs border border-border rounded bg-surface text-foreground"
              >
                {GENRES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => storyName && fileName && onPublish?.(storyName, fileName, selectedGenre)}
              disabled={!!publishingFile || overLimit}
              className="px-4 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {publishingFile === fileName ? "Publishing..." : "Publish to PlotLink"}
            </button>
            {overLimit && (
              <span className="text-error text-xs">Reduce content to publish</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
