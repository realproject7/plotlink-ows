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
