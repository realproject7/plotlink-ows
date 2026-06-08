// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";

afterEach(cleanup);

/**
 * #422: cartoon scaffold states must be explicit. The preview footer gives
 * context-aware guidance for structure.md / genesis.md / placeholder plot, a
 * placeholder plot (empty cuts) reads as "not started" rather than an error, and
 * genesis.cuts.json is discovered + summarized.
 */

const WALLET = "test-wallet-address";

/** authFetch double: routes the file GET, structure.md, and cuts GET. */
function makeAuthFetch(opts: { file: unknown; structure?: string; cuts?: unknown }) {
  return vi.fn((url: string, reqOpts?: RequestInit) => {
    const method = reqOpts?.method ?? "GET";
    if (url.endsWith("/structure.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: opts.structure ?? "" }) });
    }
    if (url.includes("/cuts/")) {
      if (opts.cuts === undefined) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(opts.cuts) });
    }
    if (url.includes("/api/stories/") && method === "GET") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(opts.file) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("PreviewPanel cartoon scaffold states (#422)", () => {
  it("structure.md footer suggests reviewing Genesis (not rewriting it) once Genesis exists", async () => {
    const authFetch = makeAuthFetch({ file: { file: "structure.md", status: "draft", content: "# Bible\n\nStyle guide." }, structure: "# Bible" });
    render(
      <PreviewPanel storyName="god-cell" fileName="structure.md" authFetch={authFetch}
        onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon" hasGenesis />,
    );
    const footer = await screen.findByTestId("footer-guidance");
    expect(footer).toHaveTextContent(/review its opening and cuts/i);
    expect(footer).not.toHaveTextContent(/write the genesis next/i);
  });

  it("structure.md footer suggests writing Genesis when none exists yet", async () => {
    const authFetch = makeAuthFetch({ file: { file: "structure.md", status: "draft", content: "# Bible" }, structure: "# Bible" });
    render(
      <PreviewPanel storyName="god-cell" fileName="structure.md" authFetch={authFetch}
        onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon" hasGenesis={false} />,
    );
    expect(await screen.findByTestId("footer-guidance")).toHaveTextContent(/Write the Genesis opening/i);
  });

  it("genesis.cuts.json is discovered + summarized, and a no-image Genesis nudges clean-image generation", async () => {
    const cuts = { version: 1, plotFile: "genesis", cuts: [
      { id: 1, shotType: "medium", description: "", characters: [], dialogue: [], narration: "", sfx: "",
        cleanImagePath: null, finalImagePath: null, exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [] },
      { id: 2, shotType: "wide", description: "", characters: [], dialogue: [], narration: "", sfx: "",
        cleanImagePath: null, finalImagePath: null, exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [] },
    ] };
    const authFetch = makeAuthFetch({
      file: { file: "genesis.md", status: "draft", content: "# 신의 세포\n\nA cell awakens in a quiet lab as the night shift ends, and nothing will be the same by dawn." },
      cuts,
    });
    render(
      <PreviewPanel storyName="god-cell" fileName="genesis.md" authFetch={authFetch}
        onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon"
        genre="Science Fiction" language="Korean" hasGenesis />,
    );
    const summary = await screen.findByTestId("cut-board-end-summary");
    expect(summary).toHaveTextContent(/2 cuts/);
    // #451: the summary distinguishes clean / lettered / uploaded.
    expect(summary).toHaveTextContent(/0 clean/);
    expect(summary).toHaveTextContent(/0 uploaded/);
    // No clean art yet → the cut cards expose the artwork action directly.
    expect(screen.getByTestId("cut-card-status-1")).toHaveTextContent("Needs image");
    expect(screen.getByTestId("card-addart-1")).toHaveTextContent("Add artwork");
  });

  it("a placeholder plot (empty cuts) reads as not-started, not a publish error, with no inline publish (#461)", async () => {
    const authFetch = makeAuthFetch({
      file: { file: "plot-02.md", status: "pending", content: "# Episode 2\n\nPlaceholder only. OWS generates the publish markdown from plot-02.cuts.json." },
      cuts: { version: 1, plotFile: "plot-02", cuts: [] },
    });
    render(
      <PreviewPanel storyName="god-cell" fileName="plot-02.md" authFetch={authFetch}
        onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon" hasGenesis
        onViewPublish={vi.fn()} />,
    );
    expect(await screen.findByText("No cuts yet")).toBeInTheDocument();
    // Not an error: the red publish-issues block must not render.
    expect(screen.queryByTestId("cartoon-publish-issues")).not.toBeInTheDocument();
    // #461: no inline publish control or persistent publish CTA on the cartoon
    // episode file view.
    expect(screen.queryByText("Publish to PlotLink")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cartoon-review-publish")).not.toBeInTheDocument();
  });
});
