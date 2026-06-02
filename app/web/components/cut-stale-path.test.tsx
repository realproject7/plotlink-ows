import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { CutListPanel } from "./CutListPanel";
import { installObjectUrlStub } from "./asset-test-utils";

// #302: a cut whose recorded cleanImagePath/finalImagePath file is missing is
// surfaced with a precise per-cut error and a repair (sync) action, instead of
// the field-based status silently claiming the cut is image-ready.
beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
});

afterEach(cleanup);

function makeCut(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, shotType: "medium", description: "Stale cut",
    characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null,
    exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [],
    ...overrides,
  };
}

/** authFetch returning cuts + a detect-clean-images response carrying `stale`. */
function mockAuthFetch(cutsData: unknown, stale: unknown[], onSync?: () => void) {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url.includes("/detect-clean-images")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [], stale }) });
    }
    if (url.includes("/sync-clean-images")) {
      onSync?.();
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, changed: true, synced: [], cleared: [1], rejected: [] }) });
    }
    if (url.includes("/asset/")) {
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"], { type: "image/webp" })) });
    }
    // cuts GET
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });
  });
}

describe("CutListPanel stale asset path surfacing (#302)", () => {
  it("shows a precise stale error + repair action for a recorded-but-missing clean image", async () => {
    const cutsData = { version: 1, plotFile: "plot-01", cuts: [makeCut({ cleanImagePath: "assets/plot-01/cut-01-clean.webp" })] };
    const stale = [{ cutId: 1, field: "cleanImagePath", path: "assets/plot-01/cut-01-clean.webp", message: "Cut 1 clean image path is recorded but the file is missing" }];
    const authFetch = mockAuthFetch(cutsData, stale);

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Stale cut")).toBeInTheDocument());
    // Collapsed header surfaces the missing state instead of "Clean ready".
    expect(screen.getByText("Image missing")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Stale cut"));
    await waitFor(() => expect(screen.getByTestId("stale-asset-1")).toBeInTheDocument());
    expect(screen.getByText("Cut 1 clean image path is recorded but the file is missing")).toBeInTheDocument();
    // Repair action triggers sync.
    expect(screen.getByTestId("repair-stale-1")).toBeInTheDocument();
  });

  it("clicking repair calls sync-clean-images", async () => {
    const cutsData = { version: 1, plotFile: "plot-01", cuts: [makeCut({ cleanImagePath: "assets/plot-01/cut-01-clean.webp" })] };
    const stale = [{ cutId: 1, field: "cleanImagePath", path: "assets/plot-01/cut-01-clean.webp", message: "Cut 1 clean image path is recorded but the file is missing" }];
    const onSync = vi.fn();
    const authFetch = mockAuthFetch(cutsData, stale, onSync);

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
    await waitFor(() => expect(screen.getByText("Stale cut")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Stale cut"));
    await waitFor(() => expect(screen.getByTestId("repair-stale-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("repair-stale-1"));
    await waitFor(() => expect(onSync).toHaveBeenCalled());
  });

  it("does not show a stale error when no stale paths are reported", async () => {
    const cutsData = { version: 1, plotFile: "plot-01", cuts: [makeCut({ cleanImagePath: "assets/plot-01/cut-01-clean.webp" })] };
    const authFetch = mockAuthFetch(cutsData, []);

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
    await waitFor(() => expect(screen.getByText("Stale cut")).toBeInTheDocument());
    expect(screen.queryByText("Image missing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Stale cut"));
    expect(screen.queryByTestId("stale-asset-1")).not.toBeInTheDocument();
  });
});
