import type { CartoonChecklist } from "@app-lib/cartoon-readiness";
import { CartoonProductionStatus } from "./CartoonProductionStatus";

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

/**
 * Guided "Finish episode" flow for a cartoon plot (#414).
 *
 * This now reuses the shared production-status surface so the Cuts workspace and
 * Publish tab speak the same workflow language and active-step text.
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

  const buttonLabel = finishing
    ? progressText || "Finishing…"
    : published
      ? "Published ✓"
      : markdownReady
        ? "Episode ready to publish"
        : "Finish episode";

  return (
    <CartoonProductionStatus
      checklist={checklist}
      markdownReady={markdownReady}
      published={published}
      issues={issues}
      title="Episode production"
      subtitle="Per-cut actions stay on each card. Open details for the full workflow and blockers."
      rootTestId="finish-episode-panel"
      detailsTestId="finish-episode-details"
      stepTestIdPrefix="finish-step"
      issuesTestId="finish-issues"
      issueGroupTestIdPrefix="finish-issue-group"
      action={(
        <button
          onClick={onFinish}
          disabled={finishing || !canFinish}
          data-testid="finish-episode-btn"
          title="Upload the exported final panels, then prepare the episode for publishing — picks up where it left off"
          className="px-2.5 py-1 text-[11px] border border-accent/40 text-accent rounded hover:bg-accent/5 disabled:opacity-50"
        >
          {buttonLabel}
        </button>
      )}
    />
  );
}
