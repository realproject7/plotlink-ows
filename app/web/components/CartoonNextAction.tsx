import { useEffect, useState, type ReactNode } from "react";
import type { StoryProgress } from "@app-lib/story-progress";
import type { CartoonCoach, CoachUiAction } from "@app-lib/cartoon-coach";

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

function CompactNextActionShell({
  badge,
  tone = "accent",
  summary,
  children,
  note,
  testId,
}: {
  badge: string;
  tone?: "accent" | "complete";
  summary: ReactNode;
  children?: ReactNode;
  note?: ReactNode;
  testId: string;
}) {
  const shellTone =
    tone === "complete"
      ? "border-green-700/20 bg-green-950/5"
      : "border-accent/30 bg-background/95";
  const badgeTone =
    tone === "complete"
      ? "bg-green-700/10 text-green-700"
      : "bg-accent/10 text-accent";
  return (
    <div
      className={`border px-3 py-3 sm:px-4 ${shellTone}`}
      data-testid={testId}
      data-state={tone === "complete" ? "complete" : "active"}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${badgeTone}`}
          >
            {badge}
          </span>
          <p className="mt-1 text-sm text-foreground">{summary}</p>
          {note ? <p className="mt-1 text-[11px] font-medium text-accent">{note}</p> : null}
        </div>
        {children ? (
          <div className="flex w-full justify-end sm:w-auto sm:flex-shrink-0">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NextActionButton({
  onClick,
  disabled,
  testId,
}: {
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      data-testid={testId}
    >
      Next Action
    </button>
  );
}

function WorkflowCoachCompact({
  coach,
  onAction,
}: {
  coach: CartoonCoach | null | undefined;
  onAction: (action: CoachUiAction, episodeFile: string | null) => void;
}) {
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const copied = copiedPrompt !== null && copiedPrompt === coach?.prompt;

  if (coach === undefined) return null;
  if (!coach) {
    return (
      <CompactNextActionShell
        badge="Complete"
        tone="complete"
        summary="No next action available."
        note="This workflow has no queued next step right now."
        testId="cartoon-next-action"
      />
    );
  }

  const button =
    coach.actionKind === "agent" && coach.prompt ? (
      <NextActionButton
        testId="workflow-coach-copy"
        onClick={() => {
          if (!coach.prompt) return;
          const prompt = coach.prompt;
          navigator.clipboard?.writeText(prompt).then(() => setCopiedPrompt(prompt)).catch(() => {});
        }}
      />
    ) : coach.actionKind === "ui" && coach.uiAction ? (
      <NextActionButton
        testId="workflow-coach-do"
        onClick={() => onAction(coach.uiAction!, coach.episodeFile)}
      />
    ) : null;

  return (
    <CompactNextActionShell
      badge={coach.stageLabel}
      summary={(
        <span data-testid="workflow-coach-action">
          <span className="font-semibold">Next: </span>
          <span>{coach.action}</span>
        </span>
      )}
      note={copied ? "Prompt copied." : undefined}
      testId="cartoon-next-action"
    >
      {button}
    </CompactNextActionShell>
  );
}

export function StoryInfoNextActionCard({
  progress,
  onOpenStoryInfo,
}: {
  progress: StoryProgress;
  onOpenStoryInfo?: () => void;
}) {
  return (
    <CompactNextActionShell
      badge="Story info"
      summary={(
        <span data-testid="story-info-next-action">
          <span className="font-semibold">Next: </span>
          <span>{storyInfoNextStep(progress)}</span>
        </span>
      )}
      testId="story-info-cta"
    >
      <NextActionButton
        testId="story-info-next-action-btn"
        onClick={() => onOpenStoryInfo?.()}
        disabled={!onOpenStoryInfo}
      />
    </CompactNextActionShell>
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
  return <WorkflowCoachCompact coach={progress.coach ?? null} onAction={onCoachAction} />;
}

export function CartoonNextAction({
  storyName,
  authFetch,
  fileName,
  refreshKey = 0,
  onCoachAction,
  onOpenStoryInfo,
}: {
  storyName: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  fileName?: string | null;
  refreshKey?: number;
  onCoachAction: (action: CoachUiAction, episodeFile: string | null) => void;
  onOpenStoryInfo?: () => void;
}) {
  const [progress, setProgress] = useState<StoryProgress | null | undefined>(undefined);

  const targetKey = JSON.stringify([storyName, fileName ?? "", refreshKey]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (loadedKey !== targetKey) {
    setProgress(undefined);
    setLoadedKey(targetKey);
  }

  useEffect(() => {
    let cancelled = false;
    const focus = fileName ? `?focus=${encodeURIComponent(fileName)}` : "";
    authFetch(`/api/stories/${storyName}/progress${focus}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: StoryProgress | null) => {
        if (!cancelled) setProgress(isValidProgress(data) ? data : null);
      })
      .catch(() => {
        if (!cancelled) setProgress(null);
      });
    return () => { cancelled = true; };
  }, [storyName, fileName, authFetch, refreshKey]);

  if (progress === undefined) return null;
  if (!progress) {
    return <WorkflowCoachCompact coach={null} onAction={onCoachAction} />;
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
