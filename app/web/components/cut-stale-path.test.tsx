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
function mockAuthFetch(cutsData: unknown, stale: unknown[], onRepair?: () => void) {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url.includes("/detect-clean-images")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [], stale }) });
    }
    if (url.includes("/repair-asset-paths")) {
      onRepair?.();
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, changed: true, cleared: [{ cutId: 1, field: "finalImagePath", path: "x", message: "m" }] }) });
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
    // The card surfaces the missing state as "Needs image" (#440), never "Ready
    // for lettering"; the precise repair stays under Open details.
    expect(screen.getByTestId("cut-card-status-1")).toHaveTextContent("Needs image");

    fireEvent.click(screen.getByText("Stale cut"));
    await waitFor(() => expect(screen.getByTestId("stale-asset-1")).toBeInTheDocument());
    expect(screen.getByText("Cut 1 clean image path is recorded but the file is missing")).toBeInTheDocument();
    // Repair action triggers sync.
    expect(screen.getByTestId("repair-stale-1")).toBeInTheDocument();
  });

  it("clicking repair calls repair-asset-paths (clears clean AND final)", async () => {
    // Final-only stale: the repair must hit repair-asset-paths, since sync cannot
    // clear a stale finalImagePath (re1).
    const cutsData = { version: 1, plotFile: "plot-01", cuts: [makeCut({ finalImagePath: "assets/plot-01/cut-01-final.webp" })] };
    const stale = [{ cutId: 1, field: "finalImagePath", path: "assets/plot-01/cut-01-final.webp", message: "Cut 1 final image path is recorded but the file is missing" }];
    const onRepair = vi.fn();
    const authFetch = mockAuthFetch(cutsData, stale, onRepair);

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
    await waitFor(() => expect(screen.getByText("Stale cut")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Stale cut"));
    await waitFor(() => expect(screen.getByTestId("repair-stale-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("repair-stale-1"));
    await waitFor(() => {
      expect(onRepair).toHaveBeenCalled();
      expect(authFetch).toHaveBeenCalledWith(
        "/api/stories/story/cuts/plot-01/repair-asset-paths",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  // #440 RE1: a cut whose recorded FINAL image is stale must not read as the
  // finished "Exported" state on the always-visible card — it needs re-review,
  // and the repair must stay reachable in Open details.
  it("a stale finalImagePath reads as 'Needs review', not 'Exported', with the repair under details", async () => {
    const cutsData = { version: 1, plotFile: "plot-01", cuts: [makeCut({ finalImagePath: "assets/plot-01/cut-01-final.webp", exportedAt: "t" })] };
    const stale = [{ cutId: 1, field: "finalImagePath", path: "assets/plot-01/cut-01-final.webp", message: "Cut 1 final image path is recorded but the file is missing" }];
    const authFetch = mockAuthFetch(cutsData, stale);

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
    await waitFor(() => expect(screen.getByText("Stale cut")).toBeInTheDocument());
    // Must NOT claim the cut is production-ready.
    await waitFor(() => expect(screen.getByTestId("cut-card-status-1")).toHaveTextContent("Needs review"));
    expect(screen.getByTestId("cut-card-status-1")).not.toHaveTextContent("Exported");
    // The precise repair stays available under Open details.
    fireEvent.click(screen.getByText("Stale cut"));
    await waitFor(() => expect(screen.getByTestId("repair-stale-1")).toBeInTheDocument());
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
