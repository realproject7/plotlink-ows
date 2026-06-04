import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { installObjectUrlStub } from "./asset-test-utils";

// #450: the cartoon publish controls must not duplicate Story Info metadata —
// the genre/language selects and the adult-content flag are removed for cartoon
// (they live in Story Info). The publish ACTION stays and reads the persisted
// metadata; the cover picker is retained as the cover-at-publish control (also
// editable in Story Info).
vi.mock("../lib/import-image", () => ({
  importImageToCompliantBlob: (f: File) => Promise.resolve(f),
}));

import { PreviewPanel } from "./PreviewPanel";

beforeAll(() => { installObjectUrlStub(); });
afterEach(cleanup);

const WALLET = "test-wallet-address";
const DRAFT_GENESIS = {
  file: "genesis.md", status: "draft",
  content:
    "# A Story\n\nThe harbor lights flicker out one by one as Dana ties off the last mooring line, her hands raw from a double shift she never agreed to take.\n\nShe has until dawn to find the manifest her brother hid before the inspectors arrive, or the whole crew loses the boat that has fed them for years.\n\nOut past the breakwater, an unfamiliar engine cuts its lights and waits. Whatever is coming, it starts tonight.",
};

function makeAuthFetch() {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url.endsWith("/cover-asset")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ found: false }) });
    // The cut workspace (Cuts sub-mode) loads a cuts file — return an empty plan.
    if (/\/cuts\/genesis$/.test(url)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "genesis", cuts: [] }) });
    if (url.includes("/api/stories/") && (!opts || (opts.method ?? "GET") === "GET")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DRAFT_GENESIS) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("cartoon publish controls are free of Story Info metadata (#450)", () => {
  // #461: the cartoon episode has no inline publish controls at all now — no
  // genre/language selects, no adult-content flag, no inline publish button, and
  // no cover picker. The publish action + cover live on the Publish tab, metadata
  // on Story Info. The episode shows the compact "Review publish checklist" CTA.
  it("shows no inline publish controls on the cartoon episode — only the Review-publish CTA", async () => {
    render(
      <PreviewPanel
        storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch() as never}
        onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon"
        onViewPublish={vi.fn()}
      />,
    );
    await screen.findByTestId("cartoon-review-publish");
    expect(screen.queryByText("Publish to PlotLink")).not.toBeInTheDocument();
    expect(screen.queryByTestId("publish-genre-select")).not.toBeInTheDocument();
    expect(screen.queryByTestId("publish-language-select")).not.toBeInTheDocument();
    expect(screen.queryByText("This story contains adult content (18+)")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cartoon-metadata-needs-story-info")).not.toBeInTheDocument();
    // The cover-at-publish picker is gone from the episode (it moved to the
    // Publish tab / Story Info).
    expect(screen.queryByTestId("prepublish-cover")).not.toBeInTheDocument();
  });

  it("routes the cartoon episode's Review-publish CTA to the Publish tab", async () => {
    const onViewPublish = vi.fn();
    render(
      <PreviewPanel
        storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch() as never}
        onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon"
        onViewPublish={onViewPublish}
      />,
    );
    fireEvent.click(await screen.findByTestId("cartoon-review-publish"));
    expect(onViewPublish).toHaveBeenCalledTimes(1);
  });

  it("keeps fiction's inline genre/language selects unchanged", async () => {
    render(
      <PreviewPanel
        storyName="tidewright" fileName="genesis.md" authFetch={makeAuthFetch() as never}
        onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="fiction"
      />,
    );
    expect(await screen.findByTestId("publish-genre-select")).toBeInTheDocument();
    expect(screen.getByTestId("publish-language-select")).toBeInTheDocument();
    expect(screen.getByText("This story contains adult content (18+)")).toBeInTheDocument();
    expect(screen.queryByTestId("cartoon-metadata-needs-story-info")).not.toBeInTheDocument();
  });

  // #461: the cartoon publish action (reading persisted genre/language) and the
  // cover-at-publish control moved to the Publish tab — see CartoonPublishPage.test
  // ("publishes a ready episode via onPublish from the Publish tab"). The cartoon
  // episode no longer hosts either, so those PreviewPanel cases were removed here.
});
