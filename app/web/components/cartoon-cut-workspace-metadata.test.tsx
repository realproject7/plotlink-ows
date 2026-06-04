import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
  it("removes the genre/language selects and the adult-content flag, pointing the writer to Story Info", async () => {
    render(
      <PreviewPanel
        storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch() as never}
        onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon"
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish to PlotLink" })).toBeInTheDocument());
    // Story Info metadata controls are gone from the cartoon publish surface.
    expect(screen.queryByTestId("publish-genre-select")).not.toBeInTheDocument();
    expect(screen.queryByTestId("publish-language-select")).not.toBeInTheDocument();
    expect(screen.queryByText("This story contains adult content (18+)")).not.toBeInTheDocument();
    // …and the writer is pointed at Story Info instead of inline selects.
    expect(screen.getByTestId("cartoon-metadata-needs-story-info")).toBeInTheDocument();
    // The cover-at-publish control is retained (also editable in Story Info).
    expect(screen.getByTestId("prepublish-cover")).toBeInTheDocument();
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

  it("hides the cover picker in the genesis cut workspace (Cuts mode), keeping it in Opening-text/Preview", async () => {
    render(
      <PreviewPanel
        storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch() as never}
        onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon"
      />,
    );
    // Preview tab (default): the cover picker is available.
    expect(await screen.findByTestId("prepublish-cover")).toBeInTheDocument();

    // Enter the cut workspace: Edit tab → Cuts sub-mode. The cover picker is gone,
    // so the cut/lettering editor gets the height.
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByTestId("genesis-edit-mode-cuts"));
    await waitFor(() => expect(screen.queryByTestId("prepublish-cover")).not.toBeInTheDocument());

    // Back to the Opening-text view: the cover picker returns.
    fireEvent.click(screen.getByTestId("genesis-edit-mode-text"));
    expect(await screen.findByTestId("prepublish-cover")).toBeInTheDocument();
  });

  it("keeps the cartoon publish action working, reading the persisted genre/language", async () => {
    const onPublish = vi.fn().mockResolvedValue(true);
    render(
      <PreviewPanel
        storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch() as never}
        onPublish={onPublish as never} publishingFile={null} walletAddress={WALLET}
        contentType="cartoon" genre="Science Fiction" language="Korean"
      />,
    );
    const btn = await screen.findByRole("button", { name: "Publish to PlotLink" });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
    expect(onPublish.mock.calls[0][2]).toBe("Science Fiction");
    expect(onPublish.mock.calls[0][3]).toBe("Korean");
  });
});
