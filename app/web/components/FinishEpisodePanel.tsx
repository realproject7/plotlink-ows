import { groupCartoonIssues, type CartoonChecklist } from "@app-lib/cartoon-readiness";

type StepStatus = "done" | "current" | "todo";

const STATUS_MARK: Record<StepStatus, string> = { done: "✓", current: "▸", todo: "○" };

interface FinishEpisodePanelProps {
  /** Writer-language production checklist for this episode (null ⇒ not a cartoon plot). */
  checklist: CartoonChecklist | null;
  /** Flat readiness/upload issues; grouped by actionable step for display. */
  issues: string[];
  /** Run the guided finish flow (upload finals → prepare episode markdown, in order). */
  onFinish: () => void;
  /** True while the finish flow is running. */
  finishing: boolean;
  /** Live progress line shown on the button while finishing (e.g. "Uploading cut 2 (2/7)…"). */
  progressText?: string;
  /** Whether there is anything left to finish (≥1 exported final not yet published). */
  canFinish: boolean;
  /** The publish markdown is built and passes readiness — "Episode sequence prepared". */
  markdownReady?: boolean;
  /** The episode is published on-chain. */
  published?: boolean;
}

interface DisplayStep {
  key: string;
  label: string;
  status: StepStatus;
  detail: string | null;
}

/**
 * Guided "Finish episode" flow for a cartoon plot (#414).
 *
 * The end-to-end pilot showed the production tail (export → upload → prepare
 * markdown → publish) was technically complete but fragmented: a writer had to know
 * which low-level button to click and read a flat wall of "Cut N: …" errors. This
 * panel makes the tail one guided surface in writer language: it shows the six
 * production steps with live status, offers ONE primary "Finish episode" action
 * that runs the remaining automatable steps in order (resumable — already-uploaded
 * cuts are skipped by the caller), and groups any blockers under the actionable
 * step heading instead of a long red list. The lower-level controls stay available
 * elsewhere in the workspace for manual recovery.
 *
 * Renders nothing when there is no checklist (e.g. a fiction plot or an unparsed
 * cut plan), so it never appears outside the cartoon flow.
 */
export function FinishEpisodePanel({
  checklist,
  issues,
  onFinish,
  finishing,
  progressText,
  canFinish,
  markdownReady = false,
  published = false,
}: FinishEpisodePanelProps) {
  if (!checklist || checklist.steps.length === 0) return null;

  const groups = groupCartoonIssues(issues);

  // The base checklist (plan → upload) models per-cut art/lettering/export/upload
  // progress; it has no notion of the publish markdown being assembled. #414 needs
  // the post-upload tail modelled explicitly, so replace its single "publish" step
  // with two real states: "Episode sequence prepared" (markdown built + ready) and
  // "Ready to publish" (which becomes "Published" once it's on-chain).
  const uploadDone = checklist.steps.find((s) => s.key === "upload")?.status === "done";
  const ready = uploadDone && markdownReady && !published; // ready to publish, not yet published

  const assembleStatus: StepStatus = published || markdownReady ? "done" : uploadDone ? "current" : "todo";
  const readyStatus: StepStatus = published ? "done" : ready ? "current" : "todo";

  const steps: DisplayStep[] = [
    ...checklist.steps.filter((s) => s.key !== "publish"),
    { key: "assemble", label: "Episode sequence prepared", status: assembleStatus, detail: null },
    { key: "ready", label: published ? "Published to PlotLink" : "Ready to publish", status: readyStatus, detail: null },
  ];

  const buttonLabel = finishing
    ? progressText || "Finishing…"
    : published
      ? "Published ✓"
      : ready
        ? "Episode ready to publish"
        : "Finish episode";

  const outstandingCount = steps.filter((s) => s.status !== "done").length;
  const issuesCount = groups.reduce((sum, g) => sum + g.lines.length, 0);

  return (
    <div
      className="px-3 py-1.5 border-b border-border bg-surface/50 flex-shrink-0"
      data-testid="finish-episode-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-foreground">Finish episode</span>
        {checklist.nextStep && (
          <span className="min-w-0 flex-1 text-[10px] text-muted truncate" data-testid="finish-next-step">
            Next: {checklist.nextStep}
          </span>
        )}
        <button
          onClick={onFinish}
          disabled={finishing || !canFinish}
          data-testid="finish-episode-btn"
          title="Upload the exported final panels, then prepare the episode for publishing — picks up where it left off"
          className="px-2.5 py-0.5 text-[11px] border border-accent/40 text-accent rounded hover:bg-accent/5 disabled:opacity-50"
        >
          {buttonLabel}
        </button>
      </div>

      <details className="mt-1" data-testid="finish-episode-details">
        <summary className="cursor-pointer select-none text-[10px] text-muted hover:text-foreground">
          {outstandingCount === 0 ? "Progress details" : `${outstandingCount} step${outstandingCount === 1 ? "" : "s"} left`}
          {issuesCount > 0 ? ` · ${issuesCount} blocker${issuesCount === 1 ? "" : "s"}` : ""}
        </summary>

        <div className="mt-1.5 space-y-1.5">
          {/* Writer-language step status — the exact webtoon production sequence. */}
          <ol className="flex flex-wrap gap-1.5">
            {steps.map((s) => (
              <li
                key={s.key}
                data-testid={`finish-step-${s.key}`}
                data-status={s.status}
                className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                  s.status === "current"
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : s.status === "done"
                      ? "border-border bg-background/70 text-foreground"
                      : "border-border/70 bg-background/40 text-muted"
                }`}
              >
                <span aria-hidden>{STATUS_MARK[s.status]}</span>
                <span>{s.label}</span>
                {s.detail && <span className="text-muted">· {s.detail}</span>}
              </li>
            ))}
          </ol>

          {/* Blockers grouped by the step that fixes them, not a flat red list. */}
          {groups.length > 0 && (
            <div className="space-y-1.5" data-testid="finish-issues">
              {groups.map((g) => (
                <div key={g.key} data-testid={`finish-issue-group-${g.key}`} className="text-[10px]">
                  <p className="font-medium text-amber-700">{g.title}</p>
                  <ul className="ml-3 list-disc text-muted">
                    {g.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
