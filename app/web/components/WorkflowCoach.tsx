import { useEffect, useState } from "react";
import type { CartoonCoach, CoachUiAction } from "@app-lib/cartoon-coach";
import type { StoryProgress } from "@app-lib/story-progress";

/**
 * Persistent cartoon workflow coach (#429). Converts the current story/episode
 * state into one stage label + one primary next action — an agent copy-paste
 * prompt or a direct in-app UI action — so a normal writer always knows the next
 * step without reading terminal logs or technical warnings. It never blocks the
 * terminal or advanced controls; it just makes the normal path obvious.
 *
 * Two pieces:
 *  - `WorkflowCoachView` is presentational (takes an already-loaded coach) so the
 *    progress overview, which already fetches the progress payload, can render it
 *    with no extra request.
 *  - `WorkflowCoach` is the self-loading container the file views use.
 *
 * Fiction is unaffected: the coach is null for fiction, so the view renders
 * nothing.
 */

interface WorkflowCoachViewProps {
  coach: CartoonCoach | null | undefined;
  /** Run an app-driven step (the agent steps copy a prompt instead). */
  onAction: (action: CoachUiAction, episodeFile: string | null) => void;
  className?: string;
  /** Show a clear completed state instead of disappearing when no coach exists. */
  showEmptyState?: boolean;
}

export function WorkflowCoachView({ coach, onAction, className = "", showEmptyState = false }: WorkflowCoachViewProps) {
  // Track the prompt that was copied rather than a bare boolean, so the "Copied!"
  // confirmation derives to false the moment the coach (and its prompt) changes —
  // no reset effect, no stale confirmation under a new stage.
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const copied = copiedPrompt !== null && copiedPrompt === coach?.prompt;

  if (coach === undefined) return null;
  if (!coach) {
    if (!showEmptyState) return null;
    return (
      <div
        className={`m-3 rounded-lg border border-green-700/25 bg-green-950/5 px-4 py-3 ${className}`}
        data-testid="workflow-coach"
        data-state="complete"
      >
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-green-700/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-green-700">
            Complete
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">No next action available</p>
            <p className="mt-0.5 text-xs text-muted">This workflow has no queued next step right now.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`m-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 shadow-sm ${className}`}
      data-testid="workflow-coach"
      data-stage={coach.stageLabel}
      data-action-kind={coach.actionKind}
      data-ui-action={coach.uiAction ?? ""}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="inline-flex rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-accent" data-testid="workflow-coach-stage">
            {coach.stageLabel}
          </span>
          <p className="mt-1 text-sm text-foreground" data-testid="workflow-coach-action">
            <span className="font-semibold">Next: </span>
            <span>{coach.action}</span>
          </p>
          {copied && <p className="mt-1 text-[11px] font-medium text-accent">Prompt copied.</p>}
        </div>
        {coach.actionKind === "agent" && coach.prompt ? (
          <button
            onClick={() => {
              if (!coach.prompt) return;
              const prompt = coach.prompt;
              navigator.clipboard?.writeText(prompt).then(() => setCopiedPrompt(prompt)).catch(() => {});
            }}
            data-testid="workflow-coach-copy"
            className="flex-shrink-0 rounded bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-accent-dim"
          >
            Next Action
          </button>
        ) : coach.actionKind === "ui" && coach.uiAction ? (
          <button
            onClick={() => onAction(coach.uiAction!, coach.episodeFile)}
            data-testid="workflow-coach-do"
            className="flex-shrink-0 rounded bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-accent-dim"
          >
            Next Action
          </button>
        ) : null}
    </div>
    </div>
  );
}

interface WorkflowCoachProps {
  storyName: string;
  /** The file currently in focus, so the coach speaks about that episode (#429). */
  fileName?: string | null;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  /** Bumped by the parent to reload after a state change (cut edit / publish). */
  refreshKey?: number;
  onAction: (action: CoachUiAction, episodeFile: string | null) => void;
  showEmptyState?: boolean;
}

/**
 * Self-loading coach for the file views. Fetches the story progress (scoped to
 * the focused file) and renders the coach bar. The coach is cleared in EVERY
 * load exit path — at the start, on a non-OK response, and on error — so a
 * previous file's coach can never linger under a different file when the new
 * request fails or 404s (the stale-state-on-error class flagged on #420/#427).
 */
export function WorkflowCoach({ storyName, fileName, authFetch, refreshKey = 0, onAction, showEmptyState = false }: WorkflowCoachProps) {
  const [coach, setCoach] = useState<CartoonCoach | null | undefined>(undefined);

  // Reset the coach the instant the target changes (file switch / refresh),
  // during render — React's recommended way to reset state on a changing input.
  // This clears the prior file's coach BEFORE the new load resolves; and because
  // the effect below sets the coach to null on a non-OK response and never sets
  // it on error, it also STAYS cleared when the new load fails or 404s (the
  // stale-state-on-error class flagged on #420/#427).
  //
  // JSON.stringify keeps the key printable and source-safe (#437): it changes
  // whenever any input changes — identical reset semantics — and it escapes the
  // parts so a separator can never collide with the values' own content.
  const targetKey = JSON.stringify([storyName, fileName ?? "", refreshKey]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (loadedKey !== targetKey) {
    setCoach(undefined);
    setLoadedKey(targetKey);
  }

  useEffect(() => {
    let cancelled = false;
    const focus = fileName ? `?focus=${encodeURIComponent(fileName)}` : "";
    authFetch(`/api/stories/${storyName}/progress${focus}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: (StoryProgress & { coach?: CartoonCoach | null }) | null) => {
        if (!cancelled) setCoach(data?.coach ?? null);
      })
      .catch(() => { /* leave it cleared — the coach is best-effort */ });
    return () => { cancelled = true; };
  }, [storyName, fileName, authFetch, refreshKey]);

  return <WorkflowCoachView coach={coach} onAction={onAction} showEmptyState={showEmptyState} />;
}
