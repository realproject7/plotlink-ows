import { useEffect, useState } from "react";
import type { StoryProgress } from "@app-lib/story-progress";
import type { CoachUiAction } from "@app-lib/cartoon-coach";
import { WorkflowCoachView } from "./WorkflowCoach";

export function storyInfoNextStep(progress: StoryProgress): string {
  if (progress.cover !== "present") {
    return progress.cover === "invalid"
      ? "Replace the cover image - it must be a valid WebP or JPEG."
      : "Add a cover image before publishing.";
  }
  const missing: string[] = [];
  if (!progress.metadata.language) missing.push("language");
  if (!progress.metadata.genre) missing.push("genre");
  if (!progress.metadata.title) missing.push("title");
  return `Add the story ${missing.join(" and ") || "details"} before publishing.`;
}

export function cartoonWorkflowActiveKey(progress: StoryProgress): string | null {
  const coach = progress.coach ?? null;
  const m = progress.metadata;
  const hasStructure = progress.setup.hasStructure;
  const hasGenesis = progress.setup.hasGenesis;
  const coverDone = progress.cover === "present";
  const metadataIncomplete = !m.title || !m.language || !m.genre;
  const activeEp = progress.episodes.find((e) => !e.published) ?? null;
  const productionPending = !!activeEp && activeEp.state !== "ready";

  if (!hasStructure) return "whitepaper";
  if (!hasGenesis) return "genesis.md";
  if (metadataIncomplete) return "story-info";
  if (productionPending && coach?.episodeFile) return coach.episodeFile;
  if (!coverDone) return "story-info";
  return coach?.episodeFile ?? null;
}

export function StoryInfoNextActionCard({
  progress,
  onOpenStoryInfo,
}: {
  progress: StoryProgress;
  onOpenStoryInfo?: () => void;
}) {
  return (
    <div className="m-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 shadow-sm" data-testid="story-info-cta">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="inline-flex rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
            Story info
          </span>
          <p className="mt-1 text-sm text-foreground" data-testid="story-info-next-action">
            <span className="font-semibold">Next: </span>
            <span>{storyInfoNextStep(progress)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenStoryInfo}
          disabled={!onOpenStoryInfo}
          className="flex-shrink-0 rounded bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="story-info-next-action-btn"
        >
          Next Action
        </button>
      </div>
    </div>
  );
}

export function CartoonNextActionView({
  progress,
  onCoachAction,
  onOpenStoryInfo,
}: {
  progress: StoryProgress;
  onCoachAction: (action: CoachUiAction, episodeFile: string | null) => void;
  onOpenStoryInfo?: () => void;
}) {
  const activeKey = cartoonWorkflowActiveKey(progress);
  if (activeKey === "story-info") {
    return <StoryInfoNextActionCard progress={progress} onOpenStoryInfo={onOpenStoryInfo} />;
  }
  return (
    <WorkflowCoachView
      coach={progress.coach ?? null}
      showEmptyState
      onAction={onCoachAction}
    />
  );
}

export function CartoonNextAction({
  storyName,
  authFetch,
  refreshKey = 0,
  onCoachAction,
  onOpenStoryInfo,
}: {
  storyName: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  refreshKey?: number;
  onCoachAction: (action: CoachUiAction, episodeFile: string | null) => void;
  onOpenStoryInfo?: () => void;
}) {
  const [progress, setProgress] = useState<StoryProgress | null | undefined>(undefined);

  const targetKey = JSON.stringify([storyName, refreshKey]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (loadedKey !== targetKey) {
    setProgress(undefined);
    setLoadedKey(targetKey);
  }

  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/stories/${storyName}/progress`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: StoryProgress | null) => {
        if (!cancelled) setProgress(isValidProgress(data) ? data : null);
      })
      .catch(() => {
        if (!cancelled) setProgress(null);
      });
    return () => { cancelled = true; };
  }, [storyName, authFetch, refreshKey]);

  if (progress === undefined) return null;
  if (!progress) {
    return <WorkflowCoachView coach={null} showEmptyState onAction={onCoachAction} />;
  }
  return (
    <CartoonNextActionView
      progress={progress}
      onCoachAction={onCoachAction}
      onOpenStoryInfo={onOpenStoryInfo}
    />
  );
}

function isValidProgress(data: StoryProgress | null): data is StoryProgress {
  return !!data
    && !!data.metadata
    && !!data.setup
    && Array.isArray(data.episodes);
}
