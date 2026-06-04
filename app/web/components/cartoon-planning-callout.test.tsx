import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";

// #461: the cartoon episode view no longer hosts publish/production controls. The
// planning-stage "Prepare episode for publish" callout, the awaiting-upload card,
// the 6-step guide, and the publish-disabled reasons all left the episode action
// bar — those now live on the Publish tab + the cut workspace's FinishEpisodePanel.
// The episode shows only production next-step guidance + a compact CTA. These
// tests assert those publish-control blocks are GONE for a cartoon plot, and that
// fiction is unchanged.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

// An image cut that has been planned but has no clean image / markdown skeleton.
const plannedCut = {
  id: 1, shotType: "wide", description: "Opening shot", characters: [],
  dialogue: [], narration: "", sfx: "",
  cleanImagePath: null, finalImagePath: null,
  exportedAt: null, uploadedCid: null, uploadedUrl: null,
  overlays: [],
};

const cutsFile = { version: 1, plotFile: "plot-01", cuts: [plannedCut] };

function makePlanningAuthFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/cuts/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsFile) });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: "# Episode 1\n\n(placeholder — no cuts markdown yet)" }),
    });
  });
}

describe("cartoon episode publish controls moved off the episode (#461)", () => {
  it("does not show the planning callout, step guide, or publish-disabled reasons in the cartoon plot episode", async () => {
    const fetch = makePlanningAuthFetch();
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={fetch} contentType="cartoon" onPublish={vi.fn()} onViewPublish={vi.fn()} />);

    // The episode offers the compact "Review publish checklist" CTA instead.
    await screen.findByTestId("cartoon-review-publish");
    expect(screen.queryByTestId("cartoon-planning-callout")).not.toBeInTheDocument();
    expect(screen.queryByTestId("generate-md-preview-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cartoon-awaiting-upload")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cartoon-publish-issues")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cartoon-step-guide")).not.toBeInTheDocument();
    expect(screen.queryByTestId("publish-disabled-reason")).not.toBeInTheDocument();
    // No inline publish button on the cartoon episode.
    expect(screen.queryByText("Publish to PlotLink")).not.toBeInTheDocument();
  });

  it("does not show the planning callout for fiction plots", async () => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: "# Chapter 1\n\nOnce upon a time." }) }),
    );
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={fetch} contentType="fiction" onPublish={vi.fn()} />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId("cartoon-planning-callout")).not.toBeInTheDocument();
    expect(screen.queryByTestId("generate-md-preview-btn")).not.toBeInTheDocument();
    // The cartoon step guide must never appear for fiction (#320).
    expect(screen.queryByTestId("cartoon-step-guide")).not.toBeInTheDocument();
  });
});
