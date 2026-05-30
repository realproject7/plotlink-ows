import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

const plannedCut = {
  id: 1, shotType: "wide", description: "Opening shot", characters: [],
  dialogue: [{ speaker: "Mira", text: "We're here." }], narration: "Dawn.", sfx: "",
  cleanImagePath: null, finalImagePath: null,
  exportedAt: null, uploadedCid: null, uploadedUrl: null,
  overlays: [],
};

const cutsFile = { version: 1, plotFile: "plot-01", cuts: [plannedCut] };

// A markdown skeleton with marker blocks but the cut still awaiting upload.
const skeletonMd = "<!-- ows:cartoon-cut cut-001 start -->\n<!-- Cut 1: awaiting upload -->\n<!-- ows:cartoon-cut cut-001 end -->";

/**
 * Mock that starts in planning state (placeholder markdown, no marker blocks) and,
 * once generate-markdown is POSTed, flips the file content to the marker skeleton.
 */
function makePlanningAuthFetch() {
  const state = { content: "# Episode 1\n\n(placeholder — no cuts markdown yet)" };
  const fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("generate-markdown") && opts?.method === "POST") {
      state.content = skeletonMd;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, warnings: ["Cut 1: missing upload URL"] }) });
    }
    if (url.includes("/cuts/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsFile) });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: state.content }),
    });
  });
  return { fetch, state };
}

describe("cartoon planning-stage callout in PreviewPanel", () => {
  it("shows Generate MD callout (not red errors) when cut plan exists but markdown skeleton is missing", async () => {
    const { fetch } = makePlanningAuthFetch();
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={fetch} contentType="cartoon" onPublish={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("cartoon-planning-callout")).toBeInTheDocument();
    });
    // The alarming missing-block error list should NOT be shown during planning.
    expect(screen.queryByTestId("cartoon-publish-issues")).not.toBeInTheDocument();
    expect(screen.getByTestId("generate-md-preview-btn")).toBeInTheDocument();
  });

  it("clicking Generate MD calls the generate-markdown endpoint and advances past planning", async () => {
    const { fetch } = makePlanningAuthFetch();
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={fetch} contentType="cartoon" onPublish={vi.fn()} />);

    const btn = await screen.findByTestId("generate-md-preview-btn");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/stories/story/cuts/plot-01/generate-markdown",
        expect.objectContaining({ method: "POST" }),
      );
    });

    // After generation the skeleton has marker blocks for every cut but no
    // uploaded images yet, so planning ends and the calm awaiting-upload state
    // appears (not a red error wall). Publish stays blocked.
    await waitFor(() => {
      expect(screen.queryByTestId("cartoon-planning-callout")).not.toBeInTheDocument();
      expect(screen.getByTestId("cartoon-awaiting-upload")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cartoon-publish-issues")).not.toBeInTheDocument();
  });

  it("does not show the planning callout for fiction plots", async () => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: "# Chapter 1\n\nOnce upon a time." }) }),
    );
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={fetch} contentType="fiction" onPublish={vi.fn()} />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId("cartoon-planning-callout")).not.toBeInTheDocument();
    expect(screen.queryByTestId("generate-md-preview-btn")).not.toBeInTheDocument();
  });
});
