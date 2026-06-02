import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

// #358: the publish panel must show the resolved PUBLIC title before publish for
// cartoon genesis (Story title) and cartoon plots (Episode title), and block raw
// filename labels ("genesis"/"plot-NN").
beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const SKELETON_MD = "<!-- ows:cartoon-cut cut-001 start -->\n<!-- Cut 1: awaiting upload -->\n<!-- ows:cartoon-cut cut-001 end -->";

function imageCut() {
  return {
    id: 1, shotType: "wide", description: "d", characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: "assets/plot-01/cut-01-clean.webp", finalImagePath: null, exportedAt: null,
    uploadedCid: null, uploadedUrl: null, overlays: [],
  };
}

// fileName drives which fixtures matter; opts let each test set genesis/structure
// content and the cuts title.
function makeFetch(opts: { genesis?: string; structure?: string; cutsTitle?: string | null; plot?: string }) {
  return vi.fn((url: string) => {
    if (url.endsWith("/cover-asset")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ found: false }) });
    }
    if (url.endsWith("/structure.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: opts.structure ?? "" }) });
    }
    if (url.includes("/cuts/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "plot-01", ...(opts.cutsTitle !== undefined && opts.cutsTitle !== null ? { title: opts.cutsTitle } : {}), cuts: [imageCut()] }) });
    }
    if (url.endsWith("/genesis.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: "genesis.md", status: "draft", content: opts.genesis ?? "" }) });
    }
    if (url.endsWith("/plot-01.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: opts.plot ?? SKELETON_MD }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

function renderPanel(fileName: string, authFetch: ReturnType<typeof makeFetch>) {
  render(
    <PreviewPanel storyName="coupon-crush" fileName={fileName} authFetch={authFetch} onPublish={vi.fn()} publishingFile={null} walletAddress="test-wallet-address" contentType="cartoon" />,
  );
}

describe("cartoon publish title preview (#358)", () => {
  it("shows the resolved Story title for a headingless cartoon genesis (from structure.md)", async () => {
    renderPanel("genesis.md", makeFetch({ genesis: "A cold opening hook with no heading.", structure: "# Coupon Crush at Closing Time\n\n## Visual Style" }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveTextContent("Story title:");
    expect(t).toHaveTextContent("Coupon Crush at Closing Time");
    expect(t).toHaveAttribute("data-raw", "false");
  });

  it("blocks publish when the resolved genesis title is still raw 'genesis'", async () => {
    renderPanel("genesis.md", makeFetch({ genesis: "# genesis\n\nhook", structure: "" }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveAttribute("data-raw", "true");
    expect(screen.getByTestId("publish-title-raw-error")).toBeInTheDocument();
    expect(screen.getByText("Publish to PlotLink").closest("button")).toBeDisabled();
  });

  it("shows the cut-plan Episode title for a cartoon plot and does not block on the title (#365)", async () => {
    renderPanel("plot-01.md", makeFetch({ cutsTitle: "The Couple Coupon" }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveTextContent("Episode title:");
    expect(t).toHaveTextContent("The Couple Coupon");
    expect(t).toHaveAttribute("data-raw", "false");
    expect(t).toHaveAttribute("data-blocked", "false");
    expect(screen.queryByTestId("publish-title-episode-required")).not.toBeInTheDocument();
  });

  it("a real H1 in the plot markdown satisfies the explicit-title requirement even with no cut-plan title (#365)", async () => {
    renderPanel("plot-01.md", makeFetch({ cutsTitle: null, plot: "# The Couple Coupon\n\n" + SKELETON_MD }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveTextContent("The Couple Coupon");
    expect(t).toHaveAttribute("data-blocked", "false");
    expect(screen.queryByTestId("publish-title-episode-required")).not.toBeInTheDocument();
  });

  it("a legacy cartoon plot with no cuts title shows 'Episode 01' (never 'plot-01') as a diagnostic but blocks publish (#365)", async () => {
    renderPanel("plot-01.md", makeFetch({ cutsTitle: null }));
    const t = await screen.findByTestId("publish-title-preview");
    // The "Episode 01" fallback is shown as a diagnostic of what the title WOULD
    // be, but it is no longer publishable (#365) — never the raw 'plot-01'.
    expect(t).toHaveTextContent("Episode 01");
    expect(t.textContent).not.toMatch(/plot-01/);
    expect(t).toHaveAttribute("data-raw", "false");
    expect(t).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("publish-title-episode-required")).toBeInTheDocument();
    expect(screen.getByText("Publish to PlotLink").closest("button")).toBeDisabled();
  });

  it("blocks publish when the cut-plan title is a generic 'Episode 01' label (#368)", async () => {
    renderPanel("plot-01.md", makeFetch({ cutsTitle: "Episode 01" }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveTextContent("Episode 01");
    expect(t).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("publish-title-episode-required")).toBeInTheDocument();
    expect(screen.getByText("Publish to PlotLink").closest("button")).toBeDisabled();
  });

  it("blocks publish when the plot H1 is a generic '# Episode 01' label (#368)", async () => {
    renderPanel("plot-01.md", makeFetch({ cutsTitle: null, plot: "# Episode 01\n\n" + SKELETON_MD }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("publish-title-episode-required")).toBeInTheDocument();
    expect(screen.getByText("Publish to PlotLink").closest("button")).toBeDisabled();
  });

  it("allows a number paired with real title text — 'Episode 01 — The Couple Coupon' (#368)", async () => {
    renderPanel("plot-01.md", makeFetch({ cutsTitle: "Episode 01 — The Couple Coupon" }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveTextContent("Episode 01 — The Couple Coupon");
    expect(t).toHaveAttribute("data-blocked", "false");
    expect(screen.queryByTestId("publish-title-episode-required")).not.toBeInTheDocument();
  });
});
