import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { installObjectUrlStub } from "./asset-test-utils";

// #301: selecting a Codex-generated PNG for a cut routes through the in-browser
// converter (importImageToCompliantBlob) and uploads a compliant WebP — no
// agent-side shell image tools. The real converter needs canvas/createImageBitmap
// (absent in jsdom), so mock the module and assert the wiring: a PNG selection
// uploads a WebP; a conversion failure surfaces an error and uploads nothing.
const mockConvert = vi.fn();
vi.mock("../lib/import-image", () => ({
  isCompliantImage: (f: { type: string; size: number }) =>
    ["image/webp", "image/jpeg"].includes(f.type) && f.size <= 1024 * 1024,
  importImageToCompliantBlob: (f: File) => mockConvert(f),
}));

import { CutListPanel } from "./CutListPanel";

beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe() { /* no-op */ }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  mockConvert.mockReset();
});

afterEach(cleanup);

function makeCut(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, shotType: "medium", description: "Upload test",
    characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null,
    exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [],
    ...overrides,
  };
}

async function expandCut(authFetch: ReturnType<typeof vi.fn>) {
  render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
  await waitFor(() => expect(screen.getByText("Upload test")).toBeInTheDocument());
  fireEvent.click(screen.getByText("Upload test"));
  await waitFor(() => expect(screen.getByText("Upload clean image")).toBeInTheDocument());
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

describe("cut clean-image PNG import (#301)", () => {
  it("converts a selected PNG and uploads a WebP to upload-clean", async () => {
    const cutsData = { version: 1, plotFile: "plot-01", cuts: [makeCut()] };
    mockConvert.mockResolvedValue(new Blob([new Uint8Array(2000)], { type: "image/webp" }));
    const authFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, cleanImagePath: "assets/plot-01/cut-01-clean.webp" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });

    const fileInput = await expandCut(authFetch);
    const png = new File([new Uint8Array(4 * 1024 * 1024)], "gen.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [png] } });

    await waitFor(() => {
      expect(mockConvert).toHaveBeenCalledTimes(1);
      expect(authFetch).toHaveBeenCalledWith(
        "/api/stories/story/cuts/plot-01/upload-clean/1",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const uploadCall = authFetch.mock.calls.find((c) => String(c[0]).includes("upload-clean"))!;
    const body = uploadCall[1].body as FormData;
    expect((body.get("file") as File).type).toBe("image/webp");
  });

  it("surfaces a clear error and uploads nothing when conversion fails", async () => {
    const cutsData = { version: 1, plotFile: "plot-01", cuts: [makeCut()] };
    mockConvert.mockRejectedValue(new Error("Cannot compress image under 1MB — reduce overlay count or image size"));
    const authFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });

    const fileInput = await expandCut(authFetch);
    const png = new File([new Uint8Array(8 * 1024 * 1024)], "huge.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [png] } });

    await waitFor(() => expect(screen.getByText(/under 1MB/)).toBeInTheDocument());
    // Only the initial cuts GET happened — no upload-clean POST.
    expect(authFetch.mock.calls.some((c) => String(c[0]).includes("upload-clean"))).toBe(false);
  });
});
