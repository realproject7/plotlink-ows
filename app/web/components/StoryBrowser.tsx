import { useState, useEffect, useCallback } from "react";

interface FileStatus {
  file: string;
  status: "published" | "published-not-indexed" | "pending" | "draft";
  txHash?: string;
  storylineId?: number;
}

interface StoryInfo {
  name: string;
  title: string | null;
  files: FileStatus[];
  hasStructure: boolean;
  hasGenesis: boolean;
  plotCount: number;
  publishedCount: number;
}

interface StoryBrowserProps {
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  selectedStory: string | null;
  selectedFile: string | null;
  onSelectFile: (storyName: string, fileName: string) => void;
  onNewStory?: () => void;
  untitledSessions?: string[];
}

const STATUS_ICON: Record<string, string> = {
  "published": "\u2713",
  "published-not-indexed": "\u26A0",
  "pending": "\u23F3",
  "draft": "\uD83D\uDCDD",
};

const STATUS_COLOR: Record<string, string> = {
  "published": "text-green-700",
  "published-not-indexed": "text-amber-700",
  "pending": "text-amber-700",
  "draft": "text-muted",
};

export function StoryBrowser({ authFetch, selectedStory, selectedFile, onSelectFile, onNewStory, untitledSessions = [] }: StoryBrowserProps) {
  const [stories, setStories] = useState<StoryInfo[]>([]);
  const [archivedStories, setArchivedStories] = useState<StoryInfo[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showArchives, setShowArchives] = useState(false);

  const loadStories = useCallback(async () => {
    try {
      const res = await authFetch("/api/stories");
      if (res.ok) {
        const data = await res.json();
        setStories(data.stories);
      }
    } catch { /* ignore */ }
  }, [authFetch]);

  const loadArchivedStories = useCallback(async () => {
    try {
      const res = await authFetch("/api/stories/archived");
      if (res.ok) {
        const data = await res.json();
        setArchivedStories(data.stories);
      }
    } catch { /* ignore */ }
  }, [authFetch]);

  const handleRestore = useCallback(async (name: string) => {
    try {
      const res = await authFetch("/api/stories/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        loadArchivedStories();
        loadStories();
      }
    } catch { /* ignore */ }
  }, [authFetch, loadArchivedStories, loadStories]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load + polling
    loadStories();
    const interval = setInterval(loadStories, 5000);
    return () => clearInterval(interval);
  }, [loadStories]);

  // Load archived stories when archives view is shown
  useEffect(() => {
    if (showArchives) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load for archives
      loadArchivedStories();
    }
  }, [showArchives, loadArchivedStories]);

  // Auto-expand selected story
  useEffect(() => {
    if (selectedStory) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from prop
      setExpanded((prev) => new Set(prev).add(selectedStory));
    }
  }, [selectedStory]);

  const getLatestFile = (files: FileStatus[]): string | null => {
    // Latest plot by highest number
    const plots = files
      .map((f) => ({ file: f.file, num: f.file.match(/^plot-(\d+)\.md$/)?.[1] }))
      .filter((p) => p.num != null)
      .sort((a, b) => parseInt(b.num!) - parseInt(a.num!));
    if (plots.length > 0) return plots[0].file;
    // Fallback: genesis, then structure
    if (files.some((f) => f.file === "genesis.md")) return "genesis.md";
    if (files.some((f) => f.file === "structure.md")) return "structure.md";
    return files[0]?.file ?? null;
  };

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleStoryClick = (story: StoryInfo) => {
    toggleExpand(story.name);
    // Auto-select latest file when expanding (not when collapsing)
    if (!expanded.has(story.name)) {
      const latest = getLatestFile(story.files);
      if (latest) onSelectFile(story.name, latest);
    }
  };

  // Sort files: structure first, genesis, then plots in order
  const sortFiles = (files: FileStatus[]) => {
    const order = (f: string) => {
      if (f === "structure.md") return 0;
      if (f === "genesis.md") return 1;
      const m = f.match(/^plot-(\d+)\.md$/);
      return m ? 2 + parseInt(m[1]) : 100;
    };
    return [...files].sort((a, b) => order(a.file) - order(b.file));
  };

  if (showArchives) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
          <span className="text-xs font-mono text-muted">Archives</span>
          <span className="text-xs text-muted">{archivedStories.length}</span>
        </div>
        <div className="px-3 py-2 border-b border-border">
          <button
            onClick={() => setShowArchives(false)}
            className="w-full px-3 py-1.5 text-sm text-muted hover:text-foreground hover:bg-surface rounded flex items-center gap-1.5"
          >
            <span>&larr;</span>
            <span>Back</span>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {archivedStories.length === 0 ? (
            <div className="p-3 text-sm text-muted">
              <p>No archived stories.</p>
            </div>
          ) : (
            archivedStories.map((story) => (
              <div key={story.name} className="px-3 py-2 flex items-center justify-between hover:bg-surface">
                <span className="text-sm font-medium truncate" title={story.name}>{story.title || story.name}</span>
                <button
                  onClick={() => handleRestore(story.name)}
                  className="text-xs text-accent hover:text-accent-dim flex-shrink-0 ml-2"
                >
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
        <span className="text-xs font-mono text-muted">Stories</span>
        <span className="text-xs text-muted">{stories.length}</span>
      </div>
      {onNewStory && (
        <div className="px-3 py-2 border-b border-border">
          <button
            onClick={onNewStory}
            className="w-full px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent-dim flex items-center justify-center gap-1.5"
          >
            <span>+</span>
            <span>New Story</span>
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Untitled new story sessions */}
        {untitledSessions.map((id) => (
          <div key={id}>
            <button
              onClick={() => onSelectFile(id, "")}
              className={`w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-surface text-sm ${
                selectedStory === id ? "bg-surface" : ""
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-600 flex-shrink-0" />
              <span className="font-medium italic text-muted">Untitled</span>
            </button>
          </div>
        ))}
        {stories.length === 0 && untitledSessions.length === 0 ? (
          <div className="p-3 text-sm text-muted">
            <p>No stories yet.</p>
            <p className="mt-1 text-xs">Click &quot;+ New Story&quot; above to start writing.</p>
          </div>
        ) : (
          stories.filter((s) => s.name !== "_example").map((story) => (
            <div key={story.name}>
              <button
                onClick={() => handleStoryClick(story)}
                className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-surface text-sm"
              >
                <span className="text-xs text-muted">{expanded.has(story.name) ? "\u25BC" : "\u25B6"}</span>
                <span className="font-medium truncate" title={story.name}>{story.title || story.name}</span>
                <span className="ml-auto text-xs text-muted">
                  {story.publishedCount}/{story.files.length}
                </span>
              </button>
              {expanded.has(story.name) && (
                <div className="pl-4">
                  {sortFiles(story.files).map((f) => {
                    const isSelected = selectedStory === story.name && selectedFile === f.file;
                    return (
                      <button
                        key={f.file}
                        onClick={() => onSelectFile(story.name, f.file)}
                        className={`w-full px-3 py-1.5 text-left flex items-center gap-2 text-xs hover:bg-surface ${
                          isSelected ? "bg-surface font-medium" : ""
                        }`}
                      >
                        <span className={STATUS_COLOR[f.status]}>{STATUS_ICON[f.status]}</span>
                        <span className="truncate font-mono">{f.file}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <div className="px-3 py-2 border-t border-border">
        <button
          onClick={() => setShowArchives(true)}
          className="w-full px-3 py-1.5 text-xs text-muted hover:text-foreground hover:bg-surface rounded flex items-center justify-center gap-1.5"
        >
          <span>Archives</span>
        </button>
      </div>
    </div>
  );
}
