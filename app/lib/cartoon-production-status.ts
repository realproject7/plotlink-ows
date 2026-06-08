import type { CartoonChecklist, CartoonChecklistStep } from "./cartoon-readiness";

export type CartoonProductionStepKey =
  | CartoonChecklistStep["key"]
  | "assemble"
  | "ready";

export interface CartoonProductionStep {
  key: CartoonProductionStepKey;
  label: string;
  status: "done" | "current" | "todo";
  detail: string | null;
}

export interface CartoonProductionStatus {
  steps: CartoonProductionStep[];
  activeStep: CartoonProductionStep | null;
  statusLabel: string | null;
  completedCount: number;
  totalCount: number;
  outstandingCount: number;
}

export function buildCartoonProductionStatus(input: {
  checklist: CartoonChecklist | null;
  markdownReady?: boolean;
  published?: boolean;
}): CartoonProductionStatus | null {
  const { checklist, markdownReady = false, published = false } = input;
  if (!checklist || checklist.steps.length === 0) return null;

  const uploadDone =
    checklist.steps.find((step) => step.key === "upload")?.status === "done";
  const ready = uploadDone && markdownReady && !published;
  const assembleStatus: CartoonProductionStep["status"] = published || markdownReady
    ? "done"
    : uploadDone
      ? "current"
      : "todo";
  const readyStatus: CartoonProductionStep["status"] = published
    ? "done"
    : ready
      ? "current"
      : "todo";

  const steps: CartoonProductionStep[] = [
    ...checklist.steps.filter((step) => step.key !== "publish"),
    {
      key: "assemble",
      label: "Episode sequence prepared",
      status: assembleStatus,
      detail: null,
    },
    {
      key: "ready",
      label: published ? "Published to PlotLink" : "Ready to publish",
      status: readyStatus,
      detail: null,
    },
  ];

  const activeStep =
    steps.find((step) => step.status === "current")
    ?? steps.find((step) => step.status === "todo")
    ?? steps[steps.length - 1]
    ?? null;
  const completedCount = steps.filter((step) => step.status === "done").length;

  return {
    steps,
    activeStep,
    statusLabel: activeStep?.label ?? null,
    completedCount,
    totalCount: steps.length,
    outstandingCount: steps.filter((step) => step.status !== "done").length,
  };
}
