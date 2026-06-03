import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FinishEpisodePanel } from "./FinishEpisodePanel";
import { cartoonChecklist } from "@app-lib/cartoon-readiness";
import type { Cut } from "@app-lib/cuts";

afterEach(cleanup);

function makeCut(overrides: Partial<Cut> = {}): Cut {
  return {
    id: 1, shotType: "medium", description: "scene", characters: [], dialogue: [],
    narration: "", sfx: "", cleanImagePath: null, finalImagePath: null,
    exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [],
    ...overrides,
  };
}

/** A cut that has been through clean → letter → export (ready to upload). */
function exportedCut(id: number, overrides: Partial<Cut> = {}): Cut {
  return makeCut({
    id,
    cleanImagePath: `assets/plot-01/cut-0${id}-clean.webp`,
    finalImagePath: `assets/plot-01/cut-0${id}-final.webp`,
    exportedAt: "2026-06-03T00:00:00Z",
    overlays: [{ id: "o1", type: "speech", x: 0.1, y: 0.1, width: 0.2, height: 0.1, text: "hi" }],
    ...overrides,
  });
}

describe("FinishEpisodePanel (#414)", () => {
  it("renders nothing without a checklist (e.g. a fiction plot)", () => {
    const { container } = render(
      <FinishEpisodePanel checklist={null} issues={[]} onFinish={vi.fn()} finishing={false} canFinish={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for an empty cut plan", () => {
    const checklist = cartoonChecklist({ cuts: [] });
    const { container } = render(
      <FinishEpisodePanel checklist={checklist} issues={[]} onFinish={vi.fn()} finishing={false} canFinish={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("PARTIAL: shows writer-language steps with current=upload and runs the finish flow on click", () => {
    // Two cuts fully exported but not uploaded → the current step is "Upload final images".
    const checklist = cartoonChecklist({ cuts: [exportedCut(1), exportedCut(2)] });
    const onFinish = vi.fn();
    render(
      <FinishEpisodePanel checklist={checklist} issues={[]} onFinish={onFinish} finishing={false} canFinish />,
    );

    // Earlier steps are done; export is done; upload is the current step; publish todo.
    expect(screen.getByTestId("finish-step-export").getAttribute("data-status")).toBe("done");
    expect(screen.getByTestId("finish-step-upload").getAttribute("data-status")).toBe("current");
    expect(screen.getByTestId("finish-step-publish").getAttribute("data-status")).toBe("todo");
    // Writer-language labels, not file jargon.
    expect(screen.getByTestId("finish-step-upload").textContent).toMatch(/Upload final images/);

    const btn = screen.getByTestId("finish-episode-btn");
    expect(btn).toHaveTextContent("Finish episode");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("READY: all steps done shows a ready-to-publish label", () => {
    const cuts = [exportedCut(1, { uploadedCid: "Qm1", uploadedUrl: "https://x/1" }),
                  exportedCut(2, { uploadedCid: "Qm2", uploadedUrl: "https://x/2" })];
    const checklist = cartoonChecklist({ cuts, published: true });
    render(
      <FinishEpisodePanel checklist={checklist} issues={[]} onFinish={vi.fn()} finishing={false} canFinish={false} />,
    );
    expect(screen.getByTestId("finish-step-publish").getAttribute("data-status")).toBe("done");
    expect(screen.getByTestId("finish-episode-btn")).toHaveTextContent("Episode ready to publish");
    expect(screen.getByTestId("finish-episode-btn")).toBeDisabled();
  });

  it("BLOCKED: groups readiness issues by actionable step instead of a flat list", () => {
    const checklist = cartoonChecklist({ cuts: [exportedCut(1), exportedCut(2), exportedCut(3)] });
    const issues = [
      "Cut 1: not uploaded",
      "Cut 2: not uploaded",
      "Cut 3: missing or incomplete markdown block",
    ];
    render(
      <FinishEpisodePanel checklist={checklist} issues={issues} onFinish={vi.fn()} finishing={false} canFinish />,
    );

    // "not uploaded" → Upload step group; markdown block → Prepare-for-publish group.
    const uploadGroup = screen.getByTestId("finish-issue-group-upload");
    expect(uploadGroup).toHaveTextContent("Upload final images");
    // The two per-cut "not uploaded" lines collapse into one "Cuts 1, 2" line.
    expect(uploadGroup).toHaveTextContent("Cuts 1, 2: not uploaded");
    expect(screen.getByTestId("finish-issue-group-assemble")).toHaveTextContent("Prepare the episode for publish");
  });

  it("FINISHING: shows live progress on a disabled button", () => {
    const checklist = cartoonChecklist({ cuts: [exportedCut(1)] });
    render(
      <FinishEpisodePanel
        checklist={checklist}
        issues={[]}
        onFinish={vi.fn()}
        finishing
        progressText="Uploading cut 1 (1/1)..."
        canFinish
      />,
    );
    const btn = screen.getByTestId("finish-episode-btn");
    expect(btn).toHaveTextContent("Uploading cut 1 (1/1)...");
    expect(btn).toBeDisabled();
  });
});
