// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const WALLET = "test-wallet-address";

/** Cartoon genesis (draft) with a valid opening so the publish form renders. */
const GENESIS = {
  file: "genesis.md",
  status: "draft",
  content: "# 신의 세포\n\nA cell awakens in a quiet lab as the night shift ends, and nothing will be the same by dawn.",
};

function genesisAuthFetch() {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url.endsWith("/cover-asset")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ found: false }) });
    if (url.endsWith("/structure.md")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: "" }) });
    if (url.includes("/cuts/")) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
    if (url.includes("/api/stories/") && (!opts || (opts.method ?? "GET") === "GET")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(GENESIS) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

function cut(id: number, o: Record<string, unknown> = {}) {
  return { id, shotType: "medium", description: "", characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null, exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [], ...o };
}

/** Cartoon plot (pending) with 2 cuts: 1 clean+lettered, 1 untouched. */
function plotAuthFetch() {
  return vi.fn((url: string) => {
    if (url.endsWith("/cover-asset")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ found: false }) });
    if (url.endsWith("/structure.md")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: "" }) });
    if (url.includes("/cuts/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "plot-01", cuts: [
        cut(1, { cleanImagePath: "a.webp", overlays: [{ id: "o1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }] }),
        cut(2),
      ] }) });
    }
    if (url.endsWith("/plot-01.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: "planning" }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("PreviewPanel bottom panel polish (#420)", () => {
  it("collapses the long cover guidance behind a 'Cover tips' details toggle", async () => {
    render(<PreviewPanel storyName="god-cell" fileName="genesis.md" authFetch={genesisAuthFetch()}
      onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon" genre="Science Fiction" language="Korean" hasGenesis />);

    // Concise status line is visible…
    const status = await screen.findByTestId("cartoon-cover-status");
    expect(status).toHaveTextContent(/no cover yet/i);
    // …and the long spec is inside a collapsed <details> (still in the DOM).
    const details = screen.getByTestId("cover-details");
    expect(details.tagName.toLowerCase()).toBe("details");
    expect(details).toHaveTextContent(/Cover tips/);
    const guidance = screen.getByTestId("cartoon-cover-guidance");
    expect(guidance).toHaveTextContent(/WebP/);
    expect(guidance).toHaveTextContent(/1MB/);
    // Collapsed by default.
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it("shows a compact cartoon production status summary with a View-progress link", async () => {
    const onViewProgress = vi.fn();
    render(<PreviewPanel storyName="god-cell" fileName="plot-01.md" authFetch={plotAuthFetch()}
      onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon" hasGenesis onViewProgress={onViewProgress} />);

    const summary = await screen.findByTestId("cartoon-status-summary");
    expect(summary).toHaveTextContent("Cuts:");
    expect(summary).toHaveTextContent("Clean: 1/2"); // 1 of 2 image cuts has a clean image
    expect(summary).toHaveTextContent("Lettered: 1/2");
    expect(summary).toHaveTextContent("Uploaded: 0/2");

    fireEvent.click(screen.getByTestId("status-view-progress"));
    expect(onViewProgress).toHaveBeenCalledTimes(1);
  });

  it("does NOT keep a prior plot's tallies when switching to a plot whose readiness fetch fails (@re1)", async () => {
    // plot-01 cuts load; plot-02 cuts throw → the summary must clear, never show
    // plot-01's numbers beside plot-02's error state.
    const authFetch = vi.fn((url: string) => {
      if (url.endsWith("/cover-asset")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ found: false }) });
      if (url.endsWith("/structure.md")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: "" }) });
      if (url.includes("/cuts/plot-02")) return Promise.reject(new Error("network"));
      if (url.includes("/cuts/plot-01")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "plot-01", cuts: [
          cut(1, { cleanImagePath: "a.webp", overlays: [{ id: "o1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }] }), cut(2),
        ] }) });
      }
      if (url.endsWith("/plot-01.md") || url.endsWith("/plot-02.md")) {
        const f = url.endsWith("/plot-02.md") ? "plot-02.md" : "plot-01.md";
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: f, status: "pending", content: "planning" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    const { rerender } = render(<PreviewPanel storyName="god-cell" fileName="plot-01.md" authFetch={authFetch}
      onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon" hasGenesis />);
    expect(await screen.findByTestId("cartoon-status-summary")).toHaveTextContent("Uploaded: 0/2");

    rerender(<PreviewPanel storyName="god-cell" fileName="plot-02.md" authFetch={authFetch}
      onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon" hasGenesis />);

    // The stale plot-01 tallies must be gone after switching to the failing plot.
    await waitFor(() => expect(screen.queryByTestId("cartoon-status-summary")).not.toBeInTheDocument());
  });
});
