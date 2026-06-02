import { CARTOON_CLEAN_IMAGE_HELP, type CartoonChecklist } from "@app-lib/cartoon-readiness";

interface CartoonStepGuideProps {
  checklist: CartoonChecklist | null;
}

const STATUS_MARK: Record<"done" | "current" | "todo", string> = {
  done: "✓",
  current: "▸",
  todo: "○",
};

/**
 * Granular step checklist for the cartoon plot workspace (#335). Renders the six
 * production steps a creator actually performs — plan cuts → create clean images
 * → add bubbles → export → upload → publish — each with real per-cut status and
 * a plain-language "next step" line, so a first-time writer can tell what to do
 * next without knowing what "markdown generation" means. The checklist is
 * computed upstream (it needs cuts.json + asset/upload/publish state); this just
 * renders it. Renders nothing when there is no checklist (e.g. a fiction plot),
 * so it never appears outside the cartoon flow.
 */
export function CartoonStepGuide({ checklist }: CartoonStepGuideProps) {
  if (!checklist || checklist.steps.length === 0) return null;
  const { steps, nextStep } = checklist;

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
            {s.detail && (
              <span className="text-muted/70 font-normal" data-testid={`cartoon-step-${s.key}-detail`}>
                ({s.detail})
              </span>
            )}
          </li>
        ))}
      </ol>
      {nextStep && (
        <span className="text-xs text-foreground mt-0.5" data-testid="cartoon-next-step">
          Next: {nextStep}
        </span>
      )}
      <span className="text-[11px] text-muted mt-0.5" data-testid="cartoon-clean-image-help">
        {CARTOON_CLEAN_IMAGE_HELP}
      </span>
    </div>
  );
}
