import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { installObjectUrlStub } from "./asset-test-utils";

// #343: after a lettering export writes finalImagePath/exportedAt, the cut
// workspace must reflect it in lockstep with the cut cards.
//
// #461: the global Episode steps panel was removed from the cartoon episode view
// (publish/production checklist moved to the Publish tab + FinishEpisodePanel), so
// this now asserts the export completes and the cut board reflects the exported
// cut — the workspace-level sync that survives the migration.
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

describe("cartoon export → cut workspace sync (#343)", () => {
  it("exports the cut and reflects the exported final in the workspace", async () => {
    vi.doMock("./export-cut", () => ({
      exportCut: vi.fn().mockResolvedValue(new Blob([new Uint8Array(10)], { type: "image/webp" })),
      ensureFontsReady: vi.fn().mockResolvedValue({ ready: true, missing: [] }),
    }));
    try {
      const { PreviewPanel } = await import("./PreviewPanel");
      const { fetch, state } = makeStatefulFetch();
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

      // Open the cut editor: Edit tab auto-opens the first editable cut.
      fireEvent.click(await screen.findByRole("button", { name: /^Edit/ }));
      await screen.findByTestId("focused-lettering-editor");

      // Export the cut (export-cut mocked so it succeeds in jsdom).
      const img = await screen.findByRole("img");
      Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
      Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
      act(() => { fireEvent.load(img); });
      await act(async () => { fireEvent.click(screen.getByTestId("export-btn")); });

      // The export wrote the final image, and the workspace re-fetched cuts (the
      // post-export sync), so the cut plan reflects the now-exported cut.
      await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/export-final/"), expect.objectContaining({ method: "POST" })));
      expect(state.cut.finalImagePath).toBe("assets/plot-01/cut-01-final.webp");
      // A cuts GET re-fetch fires after the export to resync the workspace.
      await waitFor(() => {
        const cutsGets = fetch.mock.calls.filter((c) => String(c[0]).includes("/cuts/") && (!(c[1] as RequestInit | undefined)?.method || ((c[1] as RequestInit).method ?? "GET").toUpperCase() === "GET"));
        expect(cutsGets.length).toBeGreaterThan(1);
      });
    } finally {
      vi.doUnmock("./export-cut");
    }
  });
});
