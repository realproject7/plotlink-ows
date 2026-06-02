import { cartoonWorkflowSteps, type CartoonReadinessStage } from "@app-lib/cartoon-readiness";

interface CartoonStepGuideProps {
  stage: CartoonReadinessStage | null;
  awaitingCount: number;
  totalCuts: number;
}

const STATUS_MARK: Record<"done" | "current" | "todo", string> = {
  done: "✓",
  current: "▸",
  todo: "○",
};

/**
 * Compact step checklist for the cartoon plot workspace (#320). Teaches the
 * production sequence in creator-facing language with the current step
 * highlighted and a clear "next step" line, so a first-time user can tell what to
 * do next without reading docs. Renders nothing when the stage is unknown (e.g.
 * a fiction plot), so it never appears outside the cartoon flow.
 */
export function CartoonStepGuide({ stage, awaitingCount, totalCuts }: CartoonStepGuideProps) {
  const { steps, nextStep } = cartoonWorkflowSteps({ stage, awaitingCount, totalCuts });
  if (steps.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 border border-border rounded p-3" data-testid="cartoon-step-guide">
      <span className="text-xs font-medium text-foreground">Episode steps</span>
      <ol className="flex flex-col gap-0.5">
        {steps.map((s, i) => (
          <li
            key={s.key}
            data-testid={`cartoon-step-${s.key}`}
            data-status={s.status}
            className={`text-xs flex items-center gap-1.5 ${
              s.status === "current"
                ? "text-accent font-medium"
                : s.status === "done"
                  ? "text-muted"
                  : "text-muted/70"
            }`}
          >
            <span aria-hidden>{STATUS_MARK[s.status]}</span>
            <span>
              {i + 1}. {s.label}
            </span>
          </li>
        ))}
      </ol>
      {nextStep && (
        <span className="text-xs text-foreground mt-0.5" data-testid="cartoon-next-step">
          Next: {nextStep}
        </span>
      )}
    </div>
  );
}
