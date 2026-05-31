import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
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

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
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

  it("shows the clean-image handoff helper and Copy prompt button for a cut with no clean image", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, description: "Wide city shot" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Wide city shot")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Wide city shot"));

    await waitFor(() => {
      expect(screen.getByTestId("clean-image-handoff-1")).toBeInTheDocument();
      expect(screen.getByText("Generate externally, then upload clean image")).toBeInTheDocument();
      expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument();
      // existing upload control still renders
      expect(screen.getByText("Upload clean image")).toBeInTheDocument();
    });
  });

  it("Copy prompt copies the clean-image prompt to the clipboard", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, shotType: "wide", description: "Rainy alley", characters: ["Mira"] })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Rainy alley")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Rainy alley"));

    await waitFor(() => expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("copy-prompt-1"));

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(copied).toContain("Wide shot. Rainy alley");
    expect(copied).toContain("Characters: Mira.");
    expect(copied).toContain("No speech bubbles");
    await waitFor(() => expect(screen.getByText("Copied!")).toBeInTheDocument());
  });

  it("does not show the handoff helper once a clean image exists", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp", description: "Has image" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Has image")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Has image"));

    await waitFor(() => expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument());
    expect(screen.queryByTestId("clean-image-handoff-1")).not.toBeInTheDocument();
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

  it("shows Upload & Generate button when cuts have final images", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "assets/plot-01/cut-01-final.webp", overlays: [] })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("upload-generate-btn")).toBeInTheDocument();
      expect(screen.getByTestId("upload-generate-btn")).not.toBeDisabled();
    });
  });

  it("disables Upload & Generate when all cuts are already uploaded", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "x.webp", uploadedCid: "QmDone", uploadedUrl: "https://done", overlays: [] })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("upload-generate-btn")).toBeDisabled();
    });
  });

  it("Upload & Generate calls upload-plot-image, forwards CID to set-uploaded, then generate-markdown", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "assets/plot-01/cut-01-final.webp", overlays: [] })],
    };
    // URL-aware mock (order-independent: a detect-clean-images fetch also fires on mount).
    const authFetch = vi.fn((url: string) => {
      if (url.endsWith("/detect-clean-images")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [] }) });
      if (url.includes("/asset/")) return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob([new Uint8Array(10)], { type: "image/webp" })) });
      if (url === "/api/publish/upload-plot-image") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cid: "QmNewCid123", url: "https://ipfs.example.com/QmNewCid123" }) });
      if (url.includes("set-uploaded")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      if (url.includes("generate-markdown")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, warnings: [] }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });
    });

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByTestId("upload-generate-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("upload-generate-btn"));

    await waitFor(() => {
      const calls = authFetch.mock.calls;
      const urls = calls.map((c: [string]) => c[0]);

      expect(urls).toContain("/api/stories/story/asset/plot-01/cut-01-final.webp");
      expect(urls.some((u: string) => u === "/api/publish/upload-plot-image")).toBe(true);

      const setUploadedCall = calls.find((c: [string, RequestInit?]) => typeof c[0] === "string" && c[0].includes("set-uploaded"));
      expect(setUploadedCall).toBeTruthy();
      const setUploadedBody = JSON.parse(setUploadedCall![1]?.body as string);
      expect(setUploadedBody.cid).toBe("QmNewCid123");
      expect(setUploadedBody.url).toBe("https://ipfs.example.com/QmNewCid123");

      expect(urls.some((u: string) => u.includes("generate-markdown"))).toBe(true);
    });
  });

  it("shows a Sync clean images button that POSTs sync-clean-images then reloads", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, description: "Sync scene" })],
    };
    // URL-aware mock so the extra detect-clean-images fetch on mount/after-sync
    // does not disturb call ordering.
    const authFetch = vi.fn((url: string) => {
      if (url.endsWith("/detect-clean-images")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [] }) });
      if (url.endsWith("/sync-clean-images")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, changed: true, synced: [1], rejected: [] }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });
    });

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByTestId("sync-clean-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("sync-clean-btn"));

    await waitFor(() => {
      const urls = authFetch.mock.calls.map((c: [string]) => c[0]);
      expect(urls.some((u: string) => u.includes("/sync-clean-images"))).toBe(true);
      // reload happened (GET cuts called at least twice total)
      expect(urls.filter((u: string) => u === "/api/stories/story/cuts/plot-01").length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("Synced 1"));
  });

  it("missing cut shows Copy prompt, Ask Codex and Upload affordances", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, description: "Missing scene" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Missing scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Missing scene"));

    await waitFor(() => {
      expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument();
      expect(screen.getByTestId("ask-codex-1")).toBeInTheDocument();
      expect(screen.getByTestId("ask-codex-copy-1")).toBeInTheDocument();
      expect(screen.getByText("Upload clean image")).toBeInTheDocument();
    });
  });

  it("does not show Ask Codex affordance once a clean image exists", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp", description: "Has clean" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Has clean")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Has clean"));

    await waitFor(() => expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument());
    expect(screen.queryByTestId("ask-codex-1")).not.toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 400, data: { error: "Bad data" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Bad data")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("shows actionable v1 schema guidance for invalid cuts (wrong schema)", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 400, data: { error: "plot-01.cuts.json is invalid: Cut 0 has invalid shotType" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("cuts-error")).toBeInTheDocument();
      expect(screen.getByText("Invalid cuts file")).toBeInTheDocument();
      expect(screen.getByText(/invalid shotType/)).toBeInTheDocument();
      expect(screen.getByText(/OWS v1 schema/)).toBeInTheDocument();
    });
  });

  it("shows actionable error for invalid JSON", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 400, data: { error: "plot-01.cuts.json contains invalid JSON" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText(/contains invalid JSON/)).toBeInTheDocument();
      expect(screen.getByText(/OWS v1 schema/)).toBeInTheDocument();
    });
  });

  it("missing cuts file (404) shows No cuts, not an error", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 404, data: { error: "Cuts file not found" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("No cuts yet")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cuts-error")).not.toBeInTheDocument();
  });

  // URL-aware fetch mock: cuts vs detect-clean-images vs sync-clean-images.
  function makeRouteFetch(cuts: unknown[], detected: number[]) {
    return vi.fn((url: string) => {
      let data: unknown = {};
      if (url.endsWith("/detect-clean-images")) data = { detected };
      else if (url.endsWith("/sync-clean-images")) data = { ok: true, changed: true, synced: detected, rejected: [] };
      else data = { version: 1, plotFile: "plot-01", cuts };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
    });
  }

  it("shows per-cut found-local-clean affordance when detect reports the cut id", async () => {
    const authFetch = makeRouteFetch([makeCut({ id: 1, cleanImagePath: null })], [1]);
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Test scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Test scene"));

    await waitFor(() => {
      expect(screen.getByTestId("found-local-clean-1")).toBeInTheDocument();
      expect(screen.getByText("Found local clean image — sync to cut plan")).toBeInTheDocument();
    });
  });

  it("does not show the found-local-clean affordance when detect returns empty", async () => {
    const authFetch = makeRouteFetch([makeCut({ id: 1, cleanImagePath: null })], []);
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Test scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Test scene"));

    // give detect a chance to resolve, then assert it is absent.
    await waitFor(() => expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument());
    expect(screen.queryByTestId("found-local-clean-1")).not.toBeInTheDocument();
  });

  it("clicking found-local-clean POSTs sync-clean-images and reloads cuts + detect", async () => {
    const authFetch = makeRouteFetch([makeCut({ id: 1, cleanImagePath: null })], [1]);
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Test scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Test scene"));
    await waitFor(() => expect(screen.getByTestId("found-local-clean-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("found-local-clean-1"));

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith(
        "/api/stories/story/cuts/plot-01/sync-clean-images",
        { method: "POST" },
      );
    });
    await waitFor(() => {
      const urls = authFetch.mock.calls.map((c: [string]) => c[0]);
      // cuts reloaded and detect re-fetched after sync.
      expect(urls.filter((u: string) => u === "/api/stories/story/cuts/plot-01").length).toBeGreaterThanOrEqual(2);
      expect(urls.filter((u: string) => u.endsWith("/detect-clean-images")).length).toBeGreaterThanOrEqual(2);
    });
  });
});
