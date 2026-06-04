import { useEffect, useState } from "react";
import type { StoryProgress, EpisodeState } from "@app-lib/story-progress";
import { WorkflowCoachView } from "./WorkflowCoach";

interface StoryProgressPanelProps {
  storyName: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  /** Open a file from the map (the workflow steps link to their file). */
  onOpenFile: (storyName: string, file: string) => void;
  /** Bumped by the parent to force a refresh (e.g. after a publish). */
  refreshKey?: number;
}

const STATE_ICON: Record<EpisodeState, string> = {
  published: "✓",
  ready: "●",
  "in-progress": "◐",
  planning: "○",
  placeholder: "○",
  blocked: "✕",
  draft: "○",
};

const STATE_TONE: Record<EpisodeState, string> = {
  published: "text-green-700",
  ready: "text-green-700",
  "in-progress": "text-accent",
  planning: "text-accent",
  placeholder: "text-muted",
  blocked: "text-error",
  draft: "text-muted",
};

const STATE_LABEL: Record<EpisodeState, string> = {
  published: "Published",
  ready: "Ready",
  "in-progress": "In progress",
  planning: "Planning",
  placeholder: "Not started",
  blocked: "Needs fixes",
  draft: "Draft",
};

function Chip({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "ok" | "warn" }) {
  const cls = tone === "ok" ? "text-green-700" : tone === "warn" ? "text-amber-700" : "text-muted";
  return (
    <span className="text-[11px]">
      <span className="text-muted">{label}: </span>
      <span className={`font-medium ${cls}`}>{value}</span>
    </span>
  );
}

/**
 * Story-level "View Progress" overview (#418). Shows a vertical workflow map —
 * metadata, setup, cover, and per-episode production state — so a writer sees
 * what's done and what's next without reading file names or terminal output.
 * Reuses the server-built `StoryProgress` model (cartoon episodes reuse the same
 * readiness classifier as the per-file publish UI, so a placeholder reads as
 * "Not started", never publish-ready). Renders for both fiction and cartoon.
 */
export function StoryProgressPanel({ storyName, authFetch, onOpenFile, refreshKey = 0 }: StoryProgressPanelProps) {
  const [progress, setProgress] = useState<StoryProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await authFetch(`/api/stories/${storyName}/progress`);
        const data = res.ok ? await res.json() : null;
        if (!cancelled) { setProgress(data); setLoading(false); }
      } catch {
        if (!cancelled) { setProgress(null); setLoading(false); }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [storyName, authFetch, refreshKey]);

  if (loading) {
    return <div className="h-full flex items-center justify-center text-muted text-sm" data-testid="progress-loading">Loading progress…</div>;
  }
  // Guard against a missing/malformed response (not just null) so a partial
  // payload can never crash the panel.
  if (!progress || !progress.metadata || !Array.isArray(progress.episodes)) {
    return <div className="h-full flex items-center justify-center text-muted text-sm">Could not load story progress.</div>;
  }

  const cartoon = progress.contentType === "cartoon";
  const coverTone = progress.cover === "present" ? "ok" : progress.cover === "invalid" ? "warn" : "muted";

  return (
    <div className="h-full overflow-y-auto" data-testid="story-progress-panel">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-serif text-foreground truncate">{progress.metadata.title || progress.name}</h2>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cartoon ? "bg-accent/10 text-accent" : "bg-surface text-muted"}`}>
            {cartoon ? "Cartoon" : "Fiction"}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          <Chip label="Language" value={progress.metadata.language || "Needs metadata"} tone={progress.metadata.language ? "muted" : "warn"} />
          <Chip label="Genre" value={progress.metadata.genre || "Needs metadata"} tone={progress.metadata.genre ? "muted" : "warn"} />
          {progress.metadata.isNsfw != null && <Chip label="Adult" value={progress.metadata.isNsfw ? "Yes (18+)" : "No"} />}
          {cartoon && <Chip label="Cover" value={progress.cover === "present" ? "Ready" : progress.cover === "invalid" ? "Invalid" : "Missing"} tone={coverTone} />}
        </div>
      </div>

      {/* Persistent cartoon workflow coach (#429): one stage label + one primary
          next action. For cartoon stories it supersedes the plain next-action
          line below; fiction has no coach, so it keeps the #423 line unchanged.
          UI actions from the overview open the relevant episode so the writer
          lands where the action lives. */}
      {progress.coach ? (
        <WorkflowCoachView
          coach={progress.coach}
          onAction={(action, episodeFile) => {
            if (action === "view-progress") return; // already here
            if (episodeFile) onOpenFile(storyName, episodeFile);
          }}
        />
      ) : progress.nextAction && (
        <div className="px-4 py-2 border-b border-accent/30 bg-accent/5 text-xs space-y-1.5" data-testid="progress-next-action">
          <div>
            <span className="font-medium text-foreground">Next: </span>
            <span className="text-muted">{progress.nextAction}</span>
          </div>
          {progress.nextPrompt && (
            <div className="flex items-start gap-1.5" data-testid="progress-next-prompt">
              <code className="flex-1 rounded border border-border bg-surface px-1.5 py-1 text-[10px] text-foreground break-words">{progress.nextPrompt}</code>
              <button
                onClick={() => { if (progress.nextPrompt) navigator.clipboard?.writeText(progress.nextPrompt).then(() => { setCopied(true); }).catch(() => {}); }}
                data-testid="copy-next-prompt"
                className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:border-accent hover:text-accent transition-colors flex-shrink-0"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Setup steps. */}
      <div className="px-4 py-2 border-b border-border flex flex-col gap-1">
        <StepRow done={progress.setup.hasStructure} label="Story bible (structure.md)"
          onClick={progress.setup.hasStructure ? () => onOpenFile(storyName, "structure.md") : undefined} />
        <StepRow done={progress.setup.hasGenesis} label={cartoon ? "Genesis / Episode 1 written" : "Genesis written"}
          onClick={progress.setup.hasGenesis ? () => onOpenFile(storyName, "genesis.md") : undefined} />
      </div>

      {/* Per-episode workflow map. */}
      <div className="px-4 py-2">
        <p className="text-[11px] font-medium text-muted uppercase tracking-wider mb-1.5">Episodes</p>
        {progress.episodes.length === 0 ? (
          <p className="text-xs text-muted italic" data-testid="progress-no-episodes">No episodes yet — write the Genesis to start.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {progress.episodes.map((ep) => (
              <li key={ep.file}>
                <button
                  onClick={() => onOpenFile(storyName, ep.file)}
                  data-testid={`progress-episode-${ep.file}`}
                  data-state={ep.state}
                  className="w-full text-left flex items-start gap-2 rounded px-2 py-1.5 hover:bg-surface"
                >
                  <span className={`mt-0.5 ${STATE_TONE[ep.state]}`} aria-hidden>{STATE_ICON[ep.state]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-foreground">{ep.label}</span>
                      {ep.title && <span className="text-[11px] text-muted truncate">· {ep.title}</span>}
                      <span className={`ml-auto text-[10px] font-medium ${STATE_TONE[ep.state]}`}>{STATE_LABEL[ep.state]}</span>
                    </span>
                    <span className="block text-[11px] text-muted">{ep.summary}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Compact summary. */}
      <div className="px-4 py-2 border-t border-border text-[11px] text-muted flex flex-wrap gap-x-3" data-testid="progress-summary">
        <span>{progress.summary.published} published</span>
        {cartoon && <span>{progress.summary.readyToPublish} ready</span>}
        {cartoon && progress.summary.placeholders > 0 && <span>{progress.summary.placeholders} not started</span>}
        {progress.summary.blocked > 0 && <span className="text-error">{progress.summary.blocked} need fixes</span>}
      </div>
    </div>
  );
}

function StepRow({ done, label, onClick }: { done: boolean; label: string; onClick?: () => void }) {
  const inner = (
    <span className="flex items-center gap-2 text-xs">
      <span className={done ? "text-green-700" : "text-muted"} aria-hidden>{done ? "✓" : "○"}</span>
      <span className={done ? "text-foreground" : "text-muted"}>{label}</span>
    </span>
  );
  return onClick
    ? <button onClick={onClick} className="text-left hover:underline">{inner}</button>
    : <div>{inner}</div>;
}
