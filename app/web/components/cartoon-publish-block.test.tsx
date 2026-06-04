import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

// authFetch router: serves file content and cuts.json based on URL
function makeAuthFetch(opts: { content: string; cuts: unknown; cutsOk?: boolean }) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/cuts/")) {
      return Promise.resolve({
        ok: opts.cutsOk !== false,
        status: opts.cutsOk === false ? 400 : 200,
        json: () => Promise.resolve(opts.cuts),
      });
    }
    // file content endpoint
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: opts.content }),
    });
  });
}

const uploadedCut = {
  id: 1, shotType: "wide", description: "Scene", characters: [],
  dialogue: [], narration: "", sfx: "",
  cleanImagePath: "assets/plot-01/cut-01-clean.webp",
  finalImagePath: "assets/plot-01/cut-01-final.webp",
  exportedAt: "2026-01-01", uploadedCid: "Qm", uploadedUrl: "https://ipfs/Qm",
  overlays: [],
};

describe("cartoon publish blocking in PreviewPanel", () => {
  it("shows the calm awaiting-upload panel (not red errors) for awaiting-upload skeleton", async () => {
    // Block exists for every cut, but the cut has no uploaded image yet.
    const awaitingCut = { ...uploadedCut, finalImagePath: null, exportedAt: null, uploadedCid: null, uploadedUrl: null };
    const md = "<!-- ows:cartoon-cut cut-001 start -->\n<!-- Cut 1: awaiting upload -->\n<!-- ows:cartoon-cut cut-001 end -->";
    const authFetch = makeAuthFetch({ content: md, cuts: { version: 1, plotFile: "plot-01", cuts: [awaitingCut] } });

    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="cartoon" onPublish={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("cartoon-awaiting-upload")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cartoon-publish-issues")).not.toBeInTheDocument();
    expect(screen.getByText("Publish to PlotLink")).toBeDisabled();
  });

  it("shows issues when cuts file is invalid/missing", async () => {
    const authFetch = makeAuthFetch({ content: "anything", cuts: { error: "invalid" }, cutsOk: false });

    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="cartoon" onPublish={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("cartoon-publish-issues")).toBeInTheDocument();
    });
  });

  it("no publish issues when cartoon markdown is fully ready", async () => {
    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![Scene](https://ipfs/Qm)\n<!-- ows:cartoon-cut cut-001 end -->";
    const authFetch = makeAuthFetch({ content: md, cuts: { version: 1, plotFile: "plot-01", cuts: [uploadedCut] } });

    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="cartoon" onPublish={vi.fn()} />);

    // Wait for content to load, then confirm no issues block
    await waitFor(() => {
      expect(authFetch).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("cartoon-publish-issues")).not.toBeInTheDocument();
    });
  });

  it("shows a publish-blocking re-export issue for stale tailed exports (#389)", async () => {
    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![Scene](https://ipfs/Qm)\n<!-- ows:cartoon-cut cut-001 end -->";
    const staleUploadedCut = {
      ...uploadedCut,
      overlays: [{ id: "ov1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "Hi", tailAnchor: { x: 0.5, y: 1.2 } }],
      finalRendererVersion: undefined,
    };
    const authFetch = makeAuthFetch({ content: md, cuts: { version: 1, plotFile: "plot-01", cuts: [staleUploadedCut] } });

    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="cartoon" onPublish={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("cartoon-publish-issues")).toBeInTheDocument();
    });
    // The export step is surfaced as a concise grouped heading, and the raw
    // re-export validator string is available in the collapsible technical
    // details (#421).
    expect(screen.getByTestId("cartoon-issue-group-export")).toBeInTheDocument();
    expect(screen.getByTestId("cartoon-technical-details")).toHaveTextContent(/re-export required before publish/i);
    expect(screen.getByText("Publish to PlotLink")).toBeDisabled();
  });
});
