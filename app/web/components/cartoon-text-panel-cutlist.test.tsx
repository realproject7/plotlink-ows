import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CutListPanel } from "./CutListPanel";

// #351 (re1): the CutListPanel stats must count the new "text" status (no NaN),
// and the "all clean images present" banner must reason about image cuts only —
// a text/interstitial panel has no clean image and must not satisfy it.
beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

function makeCut(over: Record<string, unknown> = {}) {
  return {
    id: 1, shotType: "wide", description: "d", characters: [],
    dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null,
    exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [],
    ...over,
  };
}

function makeFetch(cuts: unknown[]) {
  return vi.fn((url: string) => {
    if (url.endsWith("/detect-clean-images")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [] }) });
    }
    if (url.includes("/cuts/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "plot-01", cuts }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("CutListPanel text-panel stats (#351)", () => {
  it("counts text panels (no NaN) and does not show the all-clean-images banner for an all-text episode", async () => {
    const authFetch = makeFetch([makeCut({ id: 1, kind: "text", background: "#101820" })]);
    const { container } = render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(container.textContent).toMatch(/1 text panel/i));
    // No NaN leaked into the header stats.
    expect(container.textContent).not.toMatch(/NaN/);
    // An all-text episode has no clean images → the banner must not claim them.
    expect(screen.queryByTestId("clean-assets-ready")).not.toBeInTheDocument();
  });

  it("a mixed episode counts only image cuts as clean, not the text panel", async () => {
    const authFetch = makeFetch([
      makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp" }),
      makeCut({ id: 2, kind: "text" }),
    ]);
    const { container } = render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(container.textContent).toMatch(/1 clean/));
    expect(container.textContent).toMatch(/1 text panel/i);
    expect(container.textContent).not.toMatch(/NaN/);
  });
});
