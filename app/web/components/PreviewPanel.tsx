import { useState, useEffect, useCallback } from "react";
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

export function PreviewPanel({ storyName, fileName, authFetch, onPublish, publishingFile }: PreviewPanelProps) {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);

  const loadFile = useCallback(async () => {
    if (!storyName || !fileName) { setFileData(null); return; }
    try {
      const res = await authFetch(`/api/stories/${storyName}/${fileName}`);
      if (res.ok) {
        setFileData(await res.json());
      }
    } catch { /* ignore */ }
  }, [storyName, fileName, authFetch]);

  // Initial load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    setLoading(true);
    loadFile().finally(() => setLoading(false));
  }, [loadFile]);

  // Auto-refresh every 3 seconds
  useEffect(() => {
    if (!storyName || !fileName) return;
    const interval = setInterval(loadFile, 3000);
    return () => clearInterval(interval);
  }, [storyName, fileName, loadFile]);

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

  const charCount = fileData?.content?.length ?? 0;
  const isGenesis = fileName === "genesis.md";
  const charLimit = isGenesis ? 1000 : 10000;
  const overLimit = charCount > charLimit;

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
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
          <span className={`text-xs font-mono ${overLimit ? "text-error" : "text-muted"}`}>
            {charCount.toLocaleString()}/{charLimit.toLocaleString()}
          </span>
        </div>
      </div>

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

      {/* Publish bar */}
      <div className="px-3 py-2 border-t border-border flex items-center justify-between">
        {fileData?.status === "published" ? (
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
          <button
            onClick={() => storyName && fileName && onPublish?.(storyName, fileName)}
            disabled={!!publishingFile || fileData?.status === "published"}
            className="px-4 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishingFile === fileName ? "Publishing..." : "Publish to PlotLink"}
          </button>
        )}
      </div>
    </div>
  );
}
