import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { installObjectUrlStub } from "./asset-test-utils";

// #451: once a cartoon Genesis has converted/present clean images, the next-step
// surfaces must advance to lettering — NOT keep saying "generate clean images"
// (or jump to "upload"). This covers the Genesis preview footer + cut summary.
vi.mock("../lib/import-image", () => ({ importImageToCompliantBlob: (f: File) => Promise.resolve(f) }));

import { PreviewPanel } from "./PreviewPanel";

beforeAll(() => { installObjectUrlStub(); });
afterEach(cleanup);

const WALLET = "test-wallet-address";
const DRAFT_GENESIS = {
  file: "genesis.md", status: "draft",
  content:
    "# A Story\n\nThe harbor lights flicker out one by one as Dana ties off the last mooring line.\n\nShe has until dawn to find the manifest her brother hid before the inspectors arrive.\n\nOut past the breakwater, an unfamiliar engine cuts its lights and waits.",
};

/** A cut record with a clean WebP image and no overlays/final (converted, un-lettered). */
function cleanCut(id: number) {
  return {
    id, shotType: "medium", description: `Cut ${id}`, characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: `assets/genesis/cut-${String(id).padStart(2, "0")}-clean.webp`,
    finalImagePath: null, exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [],
  };
}

function makeAuthFetch() {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (/\/cuts\/genesis$/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "genesis", cuts: [cleanCut(1), cleanCut(2), cleanCut(3), cleanCut(4)] }) });
    }
    if (url.endsWith("/cover-asset")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ found: false }) });
    if (url.includes("/api/stories/") && (!opts || (opts.method ?? "GET") === "GET")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DRAFT_GENESIS) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("Genesis next-step advances to lettering once clean images exist (#451)", () => {
  it("the Genesis footer says add speech bubbles, not 'generate clean images' or 'upload'", async () => {
    render(
      <PreviewPanel
        storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch() as never}
        onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon"
      />,
    );
    const card = await screen.findByTestId("cartoon-not-started");
    await waitFor(() => expect(card).toHaveTextContent(/clean art is ready.*speech bubbles/i));
    expect(card).not.toHaveTextContent(/generate the clean images/i);
    expect(card).not.toHaveTextContent(/upload them/i);
  });

  it("the Genesis cut summary distinguishes clean / lettered / exported / uploaded", async () => {
    render(
      <PreviewPanel
        storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch() as never}
        onPublish={vi.fn()} publishingFile={null} walletAddress={WALLET} contentType="cartoon"
      />,
    );
    const summary = await screen.findByTestId("genesis-cuts-summary");
    await waitFor(() => expect(summary).toHaveTextContent("4 clean"));
    expect(summary).toHaveTextContent("0 lettered");
    expect(summary).toHaveTextContent("0 uploaded");
  });
});
