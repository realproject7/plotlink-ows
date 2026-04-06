import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

interface PreviewPanelProps {
  storyName: string | null;
  fileName: string | null;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  onPublish?: (storyName: string, fileName: string) => void;
  publishingFile?: string | null;
}

interface FileData {
  file: string;
  status: "published" | "pending" | "draft";
  content: string;
  txHash?: string;
  storylineId?: number;
}

type Tab = "preview" | "edit";

export function PreviewPanel({ storyName, fileName, authFetch, onPublish, publishingFile }: PreviewPanelProps) {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("preview");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadFile = useCallback(async () => {
    if (!storyName || !fileName) { setFileData(null); return; }
    try {
      const res = await authFetch(`/api/stories/${storyName}/${fileName}`);
      if (res.ok) {
        const data: FileData = await res.json();
        setFileData(data);
        // Only update edit content if user hasn't made unsaved changes
        if (!dirty) {
          setEditContent(data.content ?? "");
        }
      }
    } catch { /* ignore */ }
  }, [storyName, fileName, authFetch, dirty]);

  // Reset dirty state when file changes (tab persists)
  useEffect(() => {
    setDirty(false);
  }, [storyName, fileName]);

  // Initial load
  useEffect(() => {
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
        setDirty(false);
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
  const charLimit = isGenesis ? 1000 : isPlot ? 10000 : null;
  const overLimit = charLimit !== null && charCount > charLimit;

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
            onChange={(e) => { setEditContent(e.target.value); setDirty(true); }}
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
        ) : fileData?.status === "published" ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-green-700">Published</span>
            {fileData.storylineId && (
              <a
                href={`https://plotlink.xyz/story/${fileData.storylineId}`}
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
            <button
              onClick={() => storyName && fileName && onPublish?.(storyName, fileName)}
              disabled={!!publishingFile || fileData?.status === "published" || overLimit}
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
