import { useState, useCallback, useRef, useEffect } from "react";
import { StoryBrowser } from "./StoryBrowser";
import { TerminalPanel } from "./TerminalPanel";
import { PreviewPanel } from "./PreviewPanel";

interface StoriesPageProps {
  token: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
}

const STORAGE_KEY = "plotlink-panel-ratio";
const DEFAULT_RATIO = 0.6; // terminal gets 60% of available space
const MIN_PANEL_PX = 300;
const SIDEBAR_PX = 224; // w-56
const HANDLE_PX = 6;

function loadRatio(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) {
      const n = parseFloat(v);
      if (n > 0 && n < 1) return n;
    }
  } catch { /* ignore */ }
  return DEFAULT_RATIO;
}

function clampRatio(r: number, available: number): number {
  if (available <= 0) return r;
  const minR = MIN_PANEL_PX / available;
  const maxR = 1 - MIN_PANEL_PX / available;
  if (minR >= maxR) return 0.5; // panels can't both fit, split evenly
  return Math.min(maxR, Math.max(minR, r));
}

export function StoriesPage({ token, authFetch }: StoriesPageProps) {
  const [selectedStory, setSelectedStory] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [publishingFile, setPublishingFile] = useState<string | null>(null);
  const [publishProgress, setPublishProgress] = useState<string>("");
  const [ratio, setRatio] = useState(loadRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Persist ratio to localStorage
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(ratio)); } catch { /* ignore */ }
  }, [ratio]);

  // Clamp ratio on window resize so panels stay above MIN_PANEL_PX
  useEffect(() => {
    const onResize = () => {
      if (!containerRef.current) return;
      const available = containerRef.current.getBoundingClientRect().width - SIDEBAR_PX - HANDLE_PX;
      setRatio((prev) => clampRatio(prev, available));
    };
    window.addEventListener("resize", onResize);
    // Also clamp on mount in case stored ratio is out of range for current window
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleSelectFile = useCallback((storyName: string, fileName: string) => {
    setSelectedStory(storyName);
    setSelectedFile(fileName);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const available = rect.width - SIDEBAR_PX - HANDLE_PX;
      const x = ev.clientX - rect.left - SIDEBAR_PX;
      setRatio(clampRatio(x / available, available));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  const handlePublish = useCallback(async (storyName: string, fileName: string) => {
    setPublishingFile(fileName);
    setPublishProgress("Reading file...");

    try {
      // Get file content
      const fileRes = await authFetch(`/api/stories/${storyName}/${fileName}`);
      if (!fileRes.ok) throw new Error("Failed to read file");
      const fileData = await fileRes.json();

      // Extract title from first heading or filename
      const titleMatch = fileData.content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].slice(0, 60) : fileName.replace(".md", "");

      // Determine genre from structure.md if available
      let genre = "Fiction";
      try {
        const structRes = await authFetch(`/api/stories/${storyName}/structure.md`);
        if (structRes.ok) {
          const structData = await structRes.json();
          const genreMatch = structData.content.match(/genre[:\s]+(.+)/i);
          if (genreMatch) genre = genreMatch[1].trim().slice(0, 30);
        }
      } catch { /* ignore */ }

      // For plot files, find the storylineId from the genesis publish status
      let storylineId: number | undefined;
      if (fileName.match(/^plot-\d+\.md$/)) {
        try {
          const storyRes = await authFetch(`/api/stories/${storyName}`);
          if (storyRes.ok) {
            const storyData = await storyRes.json();
            const genesis = storyData.files.find((f: { file: string; storylineId?: number }) =>
              f.file === "genesis.md" && f.storylineId);
            storylineId = genesis?.storylineId;
          }
        } catch { /* ignore */ }
        if (!storylineId) {
          setPublishProgress("Error: Publish genesis first to create the storyline");
          setTimeout(() => { setPublishingFile(null); setPublishProgress(""); }, 3000);
          return;
        }
      }

      // Run publish flow via SSE
      setPublishProgress("Publishing...");
      const publishRes = await authFetch("/api/publish/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyName, fileName, title, content: fileData.content, genre, storylineId }),
      });

      if (!publishRes.ok) {
        const err = await publishRes.json();
        throw new Error(err.error || "Publish failed");
      }

      // Read SSE stream
      const reader = publishRes.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          const lines = text.split("\n").filter((l) => l.startsWith("data: "));
          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.step) setPublishProgress(data.step);
              if (data.step === "done" && data.txHash) {
                // Update publish status with gasCost
                await authFetch(`/api/stories/${storyName}/${fileName}/publish-status`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    txHash: data.txHash,
                    storylineId: data.storylineId,
                    contentCid: data.contentCid,
                    gasCost: data.gasCost,
                  }),
                });
              }
            } catch { /* ignore partial SSE */ }
          }
        }
      }

      setPublishProgress("Published!");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed";
      setPublishProgress(`Error: ${message}`);
    } finally {
      setTimeout(() => {
        setPublishingFile(null);
        setPublishProgress("");
      }, 3000);
    }
  }, [authFetch]);

  return (
    <div ref={containerRef} className="h-[calc(100vh-3.5rem)] flex">
      {/* Story Browser Sidebar */}
      <div className="w-56 border-r border-border flex-shrink-0">
        <StoryBrowser
          authFetch={authFetch}
          selectedStory={selectedStory}
          selectedFile={selectedFile}
          onSelectFile={handleSelectFile}
        />
      </div>

      {/* Terminal — sized by ratio of available space */}
      <div className="min-w-0 border-r border-border" style={{ flex: `${ratio} 0 0` }}>
        <TerminalPanel token={token} />
      </div>

      {/* Drag Handle */}
      <div
        onMouseDown={handleMouseDown}
        className="flex-shrink-0 flex items-center justify-center hover:bg-border/50 transition-colors"
        style={{ width: HANDLE_PX, cursor: "col-resize", background: "var(--border)" }}
      >
        <div className="flex flex-col gap-1">
          <div className="w-0.5 h-0.5 rounded-full" style={{ background: "var(--text-muted)" }} />
          <div className="w-0.5 h-0.5 rounded-full" style={{ background: "var(--text-muted)" }} />
          <div className="w-0.5 h-0.5 rounded-full" style={{ background: "var(--text-muted)" }} />
        </div>
      </div>

      {/* Preview — takes remaining space */}
      <div className="min-w-0 flex flex-col" style={{ flex: `${1 - ratio} 0 0` }}>
        <PreviewPanel
          storyName={selectedStory}
          fileName={selectedFile}
          authFetch={authFetch}
          onPublish={handlePublish}
          publishingFile={publishingFile}
        />
        {publishProgress && (
          <div className="px-3 py-1.5 bg-surface border-t border-border text-xs text-muted">
            {publishProgress}
          </div>
        )}
      </div>
    </div>
  );
}
