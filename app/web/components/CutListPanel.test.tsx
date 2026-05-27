import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
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

function mockAuthFetch(response: { ok: boolean; status?: number; data?: unknown }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: () => Promise.resolve(response.data ?? {}),
  });
}

function makeCut(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, shotType: "medium", description: "Test scene",
    characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null,
    exportedAt: null, uploadedCid: null, uploadedUrl: null,
    ...overrides,
  };
}

describe("CutListPanel", () => {
  it("shows empty state when no cuts file", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 404, data: { error: "Not found" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("No cuts yet")).toBeInTheDocument();
    });
  });

  it("shows missing status for cut without clean image", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: null })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("No image")).toBeInTheDocument();
      expect(screen.getByText("1 missing")).toBeInTheDocument();
    });
  });

  it("shows clean status for cut with clean image", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Clean ready")).toBeInTheDocument();
      expect(screen.getByText("1 clean")).toBeInTheDocument();
    });
  });

  it("shows lettered status for cut with finalImagePath", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({
        id: 1,
        cleanImagePath: "assets/plot-01/cut-01-clean.webp",
        finalImagePath: "assets/plot-01/cut-01-final.webp",
      })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Lettered")).toBeInTheDocument();
      expect(screen.getByText("1 lettered")).toBeInTheDocument();
    });
  });

  it("shows uploaded status for cut with uploadedCid", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, uploadedCid: "QmTest", cleanImagePath: "x.webp" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Uploaded")).toBeInTheDocument();
      expect(screen.getByText("1 uploaded")).toBeInTheDocument();
    });
  });

  it("expands cut to show upload button", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, description: "Wide city shot" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Wide city shot")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Wide city shot"));

    await waitFor(() => {
      expect(screen.getByText("Upload clean image")).toBeInTheDocument();
    });
  });

  it("shows replace button when clean image exists", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp", description: "Scene" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Scene"));

    await waitFor(() => {
      expect(screen.getByText("Replace clean image")).toBeInTheDocument();
    });
  });

  it("calls upload endpoint when file is selected", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, description: "Upload test" })],
    };
    const authFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, cleanImagePath: "assets/plot-01/cut-01-clean.webp" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({
        ...cutsData,
        cuts: [{ ...cutsData.cuts[0], cleanImagePath: "assets/plot-01/cut-01-clean.webp" }],
      }) });

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Upload test")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Upload test"));
    await waitFor(() => expect(screen.getByText("Upload clean image")).toBeInTheDocument());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["img"], "test.webp", { type: "image/webp" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith(
        "/api/stories/story/cuts/plot-01/upload-clean/1",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("passes language to editor for non-English cartoon", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp", description: "Korean scene", overlays: [{
        id: "kr-overlay", type: "speech", x: 0.1, y: 0.1, width: 0.25, height: 0.12,
        text: "안녕", speaker: "주인공",
      }] })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} language="Korean" />);

    await waitFor(() => expect(screen.getByText("Korean scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Korean scene"));
    await waitFor(() => expect(screen.getByText("Open editor")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Open editor"));

    // Simulate image load in editor
    const img = document.querySelector("img");
    if (img) {
      Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
      Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
      act(() => { fireEvent.load(img); });
    }

    // Click the overlay to see inspector font
    await waitFor(() => expect(screen.getByTestId("overlay-kr-overlay")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("overlay-kr-overlay"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-font")).toHaveTextContent("Noto Sans KR");
    });
  });

  it("shows error state on fetch failure", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 400, data: { error: "Bad data" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Bad data")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });
});
