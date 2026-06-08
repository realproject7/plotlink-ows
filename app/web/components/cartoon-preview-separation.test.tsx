import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

// A fully-uploaded cut whose planning description/dialogue exist in cuts.json
// but must NOT appear in the Publish Preview (only in the Cut Inspector).
const uploadedCut = {
  id: 1, shotType: "wide", description: "PLANNING_DESCRIPTION_TEXT", characters: ["Mira"],
  dialogue: [{ speaker: "Mira", text: "PLANNING_DIALOGUE_TEXT" }], narration: "", sfx: "",
  cleanImagePath: "assets/plot-01/cut-01-clean.webp",
  finalImagePath: "assets/plot-01/cut-01-final.webp",
  exportedAt: "2026-01-01", uploadedCid: "Qm", uploadedUrl: "https://ipfs/Qm",
  overlays: [],
};

const PUBLISH_MD = "<!-- ows:cartoon-cut cut-001 start -->\n![Scene](https://ipfs/Qm)\n<!-- ows:cartoon-cut cut-001 end -->";

function makeAuthFetch(content: string, cuts: unknown) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/cuts/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cuts) });
    }
    if (url.includes("/asset/")) {
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"], { type: "image/webp" })) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content }) });
  });
}

describe("cartoon episode preview routing", () => {
  it("renders the episode cut board, not publish markdown prose", async () => {
    const authFetch = makeAuthFetch(PUBLISH_MD, { version: 1, plotFile: "plot-01", cuts: [uploadedCut] });
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="cartoon" onPublish={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("cut-list-panel")).toBeInTheDocument());
    expect(screen.getByTestId("cut-board-end-summary")).toHaveTextContent("1 cuts");
    expect(screen.queryByTestId("cartoon-publish-preview")).not.toBeInTheDocument();
    expect(screen.getByTestId("cut-desc-1")).toHaveTextContent("PLANNING_DESCRIPTION_TEXT");
    expect(screen.queryByText(/PLANNING_DIALOGUE_TEXT/)).not.toBeInTheDocument();
  });

  it("the cut board can reveal cuts.json planning metadata in card details", async () => {
    const authFetch = makeAuthFetch(PUBLISH_MD, { version: 1, plotFile: "plot-01", cuts: [uploadedCut] });
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="cartoon" onPublish={vi.fn()} />);

    await screen.findByTestId("cut-list-panel");
    expect(screen.getByTestId("cut-desc-1")).toHaveTextContent("PLANNING_DESCRIPTION_TEXT");
    expect(screen.queryByTestId("cartoon-publish-preview")).not.toBeInTheDocument();
  });

  it("leftover non-image markdown prose is not shown in the episode cut preview", async () => {
    const md = `Placeholder only. OWS should generate the publish markdown from cuts.json.\n\n${PUBLISH_MD}`;
    const authFetch = makeAuthFetch(md, { version: 1, plotFile: "plot-01", cuts: [uploadedCut] });
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="cartoon" onPublish={vi.fn()} />);

    await screen.findByTestId("cut-list-panel");
    expect(screen.queryByText(/Placeholder only/)).not.toBeInTheDocument();
  });

  it("fiction preview is unchanged (no cartoon mode toggle)", async () => {
    const authFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: "# Chapter\n\nProse." }) });
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="fiction" onPublish={vi.fn()} />);

    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(screen.queryByTestId("cartoon-mode-publish")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cartoon-publish-preview")).not.toBeInTheDocument();
  });
});
