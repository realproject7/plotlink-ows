import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { installObjectUrlStub } from "./asset-test-utils";

// #343: after a lettering export writes finalImagePath/exportedAt, the global
// Episode steps panel (in PreviewPanel) must refresh in lockstep with the cut
// cards (in the embedded CutListPanel) — it previously stayed at
// "Export final images (0 / 1 cut)" because PreviewPanel never re-fetched cuts.
beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

function speechOverlay() {
  return { id: "ov1", type: "speech", x: 0.1, y: 0.2, width: 0.25, height: 0.12, text: "Hi", speaker: "Mira", tailAnchor: { x: 0.5, y: 1.2 } };
}

// A cut with a clean image + placed overlay, not yet exported. The mutable
// `state.cut` flips to exported when the editor POSTs export-final.
function makeStatefulFetch() {
  const state = {
    cut: {
      id: 1, shotType: "medium", description: "Opening shot", characters: [],
      dialogue: [], narration: "", sfx: "",
      cleanImagePath: "assets/plot-01/cut-01-clean.webp",
      finalImagePath: null as string | null, exportedAt: null as string | null,
      uploadedCid: null, uploadedUrl: null,
      overlays: [speechOverlay()],
    },
  };
  const fetch = vi.fn((url: string, opts?: RequestInit) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (url.includes("/export-final/") && method === "POST") {
      state.cut.finalImagePath = "assets/plot-01/cut-01-final.webp";
      state.cut.exportedAt = "2026-06-02T00:00:00Z";
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, finalImagePath: state.cut.finalImagePath }) });
    }
    if (url.includes("/asset/")) {
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob([new Uint8Array(10)], { type: "image/webp" })) });
    }
    if (url.endsWith("/detect-clean-images")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [] }) });
    }
    if (url.includes("/cuts/")) {
      // Cut plan (GET) and overlay save (PUT) both return the current plan.
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "plot-01", cuts: [state.cut] }) });
    }
    if (url.endsWith("/plot-01.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: "" }) });
    }
    // structure.md genre detect + any other GET.
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: "" }) });
  });
  return { fetch, state };
}

describe("cartoon export → Episode steps sync (#343)", () => {
  it("advances the Episode export step from 0/1 to 1/1 after a lettering export", async () => {
    vi.doMock("./export-cut", () => ({
      exportCut: vi.fn().mockResolvedValue(new Blob([new Uint8Array(10)], { type: "image/webp" })),
      ensureFontsReady: vi.fn().mockResolvedValue({ ready: true, missing: [] }),
    }));
    try {
      const { PreviewPanel } = await import("./PreviewPanel");
      const { fetch } = makeStatefulFetch();
      render(
        <PreviewPanel
          storyName="story"
          fileName="plot-01.md"
          authFetch={fetch}
          onPublish={vi.fn()}
          publishingFile={null}
          contentType="cartoon"
        />,
      );

      // Episode steps: export is the current step at 0 / 1 before exporting.
      await waitFor(() => expect(screen.getByTestId("cartoon-step-export")).toHaveAttribute("data-status", "current"));
      expect(screen.getByTestId("cartoon-step-export-detail")).toHaveTextContent("0 / 1 cut");

      // Open the cut editor: Edit tab → expand cut → Open editor.
      fireEvent.click(screen.getByText("Edit"));
      fireEvent.click(await screen.findByText("Opening shot"));
      fireEvent.click(await screen.findByText("Open editor"));

      // Export the cut (export-cut mocked so it succeeds in jsdom).
      const img = await screen.findByRole("img");
      Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
      Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
      act(() => { fireEvent.load(img); });
      await act(async () => { fireEvent.click(screen.getByTestId("export-btn")); });

      // The Episode steps panel refreshes: export now done at 1 / 1, upload next.
      await waitFor(() => expect(screen.getByTestId("cartoon-step-export")).toHaveAttribute("data-status", "done"));
      expect(screen.getByTestId("cartoon-step-export-detail")).toHaveTextContent("1 / 1 cut");
      expect(screen.getByTestId("cartoon-step-upload")).toHaveAttribute("data-status", "current");
      expect(screen.getByTestId("cartoon-next-step")).toHaveTextContent(/upload the exported final images/i);
    } finally {
      vi.doUnmock("./export-cut");
    }
  });
});
