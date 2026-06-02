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
    <div
      className="w-full max-w-[32rem] flex flex-col gap-3 rounded-xl border border-border bg-surface/70 p-3"
      data-testid="cartoon-step-guide"
      data-layout="diagram"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">Episode steps</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted">Flow</span>
      </div>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={s.key}
            data-testid={`cartoon-step-${s.key}`}
            data-status={s.status}
            className={`rounded-lg border px-2.5 py-2 text-xs ${
              s.status === "current"
                ? "border-accent/40 bg-accent/10 text-accent"
                : s.status === "done"
                  ? "border-border bg-background/70 text-foreground"
                  : "border-border/80 bg-background/50 text-muted"
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                aria-hidden
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                  s.status === "current"
                    ? "bg-accent text-white"
                    : s.status === "done"
                      ? "bg-foreground text-background"
                      : "bg-surface text-muted"
                }`}
              >
                {STATUS_MARK[s.status]}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="leading-tight">
                  {i + 1}. {s.label}
                </span>
                {s.detail && (
                  <span className="font-normal text-[10px] text-muted" data-testid={`cartoon-step-${s.key}-detail`}>
                    {s.detail}
                  </span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="rounded-lg border border-border/80 bg-background/60 px-3 py-2">
        {nextStep && (
          <span className="block text-xs text-foreground mt-0.5" data-testid="cartoon-next-step">
            Next: {nextStep}
          </span>
        )}
        <span className="mt-1 block text-[11px] text-muted" data-testid="cartoon-clean-image-help">
          {CARTOON_CLEAN_IMAGE_HELP}
        </span>
      </div>
    </div>
  );
}
