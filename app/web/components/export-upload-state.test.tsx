import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { CutListPanel } from "./CutListPanel";

beforeAll(() => {
  global.ResizeObserver = class {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      Object.defineProperty(target, "clientWidth", { value: 400, configurable: true });
      Object.defineProperty(target, "clientHeight", { value: 300, configurable: true });
      this.callback([{ contentRect: { width: 400, height: 300 }, target } as unknown as ResizeObserverEntry], this);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

function makeCut(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, shotType: "medium", description: "Test",
    characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null,
    exportedAt: null, uploadedCid: null, uploadedUrl: null,
    overlays: [],
    ...overrides,
  };
}

describe("export state refresh and save-before-export", () => {
  it("export calls onSave then export then onExported in order", async () => {
    vi.doMock("./export-cut", () => ({
      exportCut: vi.fn().mockResolvedValue(new Blob([new Uint8Array(10)], { type: "image/webp" })),
      ensureFontsReady: vi.fn().mockResolvedValue({ ready: true, missing: [] }),
    }));
    const { LetteringEditor } = await import("./LetteringEditor");

    const callOrder: string[] = [];
    const onSave = vi.fn().mockImplementation(async () => { callOrder.push("save"); });
    const onExported = vi.fn().mockImplementation(() => { callOrder.push("exported"); });
    const authFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, finalImagePath: "x.webp" }) });

    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp", overlays: [] })}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={onSave}
        onClose={vi.fn()}
        onExported={onExported}
      />,
    );

    fireEvent.click(screen.getByTestId("export-btn"));

    await waitFor(() => {
      expect(onExported).toHaveBeenCalled();
    });

    expect(callOrder).toEqual(["save", "exported"]);
    expect(onSave).toHaveBeenCalledBefore(onExported);

    vi.doUnmock("./export-cut");
  });

  it("export blocks if save rejects", async () => {
    const { LetteringEditor } = await import("./LetteringEditor");
    const onSave = vi.fn().mockRejectedValue(new Error("Save failed"));
    const onExported = vi.fn();
    const authFetch = vi.fn();

    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp", overlays: [] })}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={onSave}
        onClose={vi.fn()}
        onExported={onExported}
      />,
    );

    fireEvent.click(screen.getByTestId("export-btn"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
      expect(onExported).not.toHaveBeenCalled();
    });
  });
});

describe("Upload & Generate failure visibility", () => {
  it("shows error when asset fetch fails", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "assets/plot-01/cut-01-final.webp" })],
    };

    const authFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) })
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByTestId("upload-generate-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("upload-generate-btn"));

    await waitFor(() => {
      expect(screen.getByText(/Cut 1: failed to fetch asset/)).toBeInTheDocument();
    });
  });

  it("shows error when upload fails", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 2, finalImagePath: "assets/plot-01/cut-02-final.webp" })],
    };

    const authFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) })
      .mockResolvedValueOnce({ ok: true, status: 200, blob: () => Promise.resolve(new Blob([new Uint8Array(10)], { type: "image/webp" })) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: "Server error" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByTestId("upload-generate-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("upload-generate-btn"));

    await waitFor(() => {
      expect(screen.getByText(/Cut 2: upload failed/)).toBeInTheDocument();
    });
  });

  it("does not generate markdown when uploads fail", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "assets/plot-01/cut-01-final.webp" })],
    };

    const authFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) })
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByTestId("upload-generate-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("upload-generate-btn"));

    await waitFor(() => {
      expect(screen.getByText(/Cut 1: failed/)).toBeInTheDocument();
    });

    const calls = authFetch.mock.calls.map((c: [string]) => c[0]);
    expect(calls.some((u: string) => u.includes("generate-markdown"))).toBe(false);
  });

  it("shows markdown warnings after successful upload", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "assets/plot-01/cut-01-final.webp" })],
    };

    const authFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) })
      .mockResolvedValueOnce({ ok: true, status: 200, blob: () => Promise.resolve(new Blob([new Uint8Array(10)], { type: "image/webp" })) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ cid: "Qm1", url: "https://ipfs/Qm1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, warnings: ["Cut 1: missing upload URL"] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByTestId("upload-generate-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("upload-generate-btn"));

    await waitFor(() => {
      expect(screen.getByText(/Cut 1: missing upload URL/)).toBeInTheDocument();
    });
  });
});
