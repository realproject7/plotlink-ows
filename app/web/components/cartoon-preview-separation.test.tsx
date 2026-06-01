import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
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

describe("cartoon Publish Preview vs Cut Inspector separation (#289)", () => {
  it("defaults to Publish Preview, which shows the markdown but NOT cuts.json planning prose", async () => {
    const authFetch = makeAuthFetch(PUBLISH_MD, { version: 1, plotFile: "plot-01", cuts: [uploadedCut] });
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="cartoon" onPublish={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("cartoon-publish-preview")).toBeInTheDocument());
    // Publish summary present; planning description/dialogue absent from publish view.
    expect(screen.getByTestId("cartoon-publish-summary")).toHaveTextContent("1 image");
    expect(screen.queryByText("PLANNING_DESCRIPTION_TEXT")).not.toBeInTheDocument();
    expect(screen.queryByText(/PLANNING_DIALOGUE_TEXT/)).not.toBeInTheDocument();
  });

  it("switching to Cut Inspector reveals the cuts.json planning metadata", async () => {
    const authFetch = makeAuthFetch(PUBLISH_MD, { version: 1, plotFile: "plot-01", cuts: [uploadedCut] });
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="cartoon" onPublish={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("cartoon-mode-inspect")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("cartoon-mode-inspect"));

    await waitFor(() => {
      expect(screen.getByText("PLANNING_DESCRIPTION_TEXT")).toBeInTheDocument();
    });
    // The publish preview surface is no longer mounted in inspector mode.
    expect(screen.queryByTestId("cartoon-publish-preview")).not.toBeInTheDocument();
  });

  it("Publish Preview surfaces leftover non-image prose in the markdown (#286 signal)", async () => {
    const md = `Placeholder only. OWS should generate the publish markdown from cuts.json.\n\n${PUBLISH_MD}`;
    const authFetch = makeAuthFetch(md, { version: 1, plotFile: "plot-01", cuts: [uploadedCut] });
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="cartoon" onPublish={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("cartoon-nonimage-prose")).toHaveTextContent("Placeholder only");
    });
  });

  it("fiction preview is unchanged (no cartoon mode toggle)", async () => {
    const authFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: "# Chapter\n\nProse." }) });
    render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} contentType="fiction" onPublish={vi.fn()} />);

    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(screen.queryByTestId("cartoon-mode-publish")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cartoon-publish-preview")).not.toBeInTheDocument();
  });
});
