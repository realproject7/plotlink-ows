import { groupCartoonIssues, type CartoonChecklist } from "@app-lib/cartoon-readiness";
import { buildCartoonProductionStatus } from "@app-lib/cartoon-production-status";
import type { ReactNode } from "react";

const STATUS_MARK: Record<"done" | "current" | "todo", string> = {
  done: "✓",
  current: "▸",
  todo: "○",
};

interface CartoonProductionStatusProps {
  checklist: CartoonChecklist | null;
  markdownReady?: boolean;
  published?: boolean;
  issues?: string[];
  title?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  rootTestId?: string;
  detailsTestId?: string;
  stepTestIdPrefix?: string;
  issuesTestId?: string;
  issueGroupTestIdPrefix?: string;
  detailsLabel?: string;
  summaryTestId?: string;
}

export function CartoonProductionStatus({
  checklist,
  markdownReady = false,
  published = false,
  issues = [],
  title = "Episode production",
  subtitle,
  action,
  rootTestId = "cartoon-production-status",
  detailsTestId = "cartoon-production-details",
  stepTestIdPrefix = "cartoon-production-step",
  issuesTestId,
  issueGroupTestIdPrefix,
  detailsLabel,
  summaryTestId,
}: CartoonProductionStatusProps) {
  const production = buildCartoonProductionStatus({
    checklist,
    markdownReady,
    published,
  });
  if (!production) return null;

  const groups = groupCartoonIssues(issues);
  const issuesCount = groups.reduce((sum, group) => sum + group.lines.length, 0);
  const statusLabel = production.statusLabel ?? "Review cuts";
  const progressLabel = `${production.completedCount} / ${production.totalCount} steps done`;
  const detailsText = detailsLabel
    ?? (production.outstandingCount === 0
      ? "Production details"
      : `${production.outstandingCount} step${production.outstandingCount === 1 ? "" : "s"} left`);

  return (
    <div
      className="rounded-lg border border-border bg-background/80 px-3 py-2"
      data-testid={rootTestId}
    >
      <div className="flex flex-wrap items-start gap-2 justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="font-medium text-foreground">{title}</span>
            <span
              className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-medium text-accent"
              data-testid={summaryTestId}
            >
              Active: {statusLabel}
            </span>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-muted">
              {progressLabel}
            </span>
            {production.activeStep?.detail && (
              <span className="text-muted">{production.activeStep.detail}</span>
            )}
          </div>
          {subtitle ? (
            <div className="text-[10px] text-muted">{subtitle}</div>
          ) : null}
        </div>
        {action ? <div className="flex-shrink-0">{action}</div> : null}
      </div>

      <details className="mt-2" data-testid={detailsTestId}>
        <summary className="cursor-pointer select-none text-[10px] text-muted hover:text-foreground">
          {detailsText}
          {issuesCount > 0 ? ` · ${issuesCount} blocker${issuesCount === 1 ? "" : "s"}` : ""}
        </summary>

        <div className="mt-1.5 space-y-1.5">
          <ol className="flex flex-wrap gap-1.5">
            {production.steps.map((step) => (
              <li
                key={step.key}
                data-testid={`${stepTestIdPrefix}-${step.key}`}
                data-status={step.status}
                className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                  step.status === "current"
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : step.status === "done"
                      ? "border-border bg-background/70 text-foreground"
                      : "border-border/70 bg-background/40 text-muted"
                }`}
              >
                <span aria-hidden>{STATUS_MARK[step.status]}</span>
                <span>{step.label}</span>
                {step.detail && <span className="text-muted">· {step.detail}</span>}
              </li>
            ))}
          </ol>

          {groups.length > 0 && (
            <div
              className="space-y-1.5"
              data-testid={issuesTestId ?? `${stepTestIdPrefix}-issues`}
            >
              {groups.map((group) => (
                <div
                  key={group.key}
                  data-testid={`${issueGroupTestIdPrefix ?? `${stepTestIdPrefix}-issue-group`}-${group.key}`}
                  className="text-[10px]"
                >
                  <p className="font-medium text-amber-700">{group.title}</p>
                  <ul className="ml-3 list-disc text-muted">
                    {group.lines.map((line, i) => (
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
