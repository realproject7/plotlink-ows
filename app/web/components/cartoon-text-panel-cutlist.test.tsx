import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
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

  // #352: a one-click "Add text panel" affordance — discoverable without docs.
  it("'Add text panel' appends a kind:'text' cut to the plan", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const authFetch = vi.fn((url: string, opts?: RequestInit) => {
      calls.push({ url, method: opts?.method, body: opts?.body });
      if (url.endsWith("/detect-clean-images")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [] }) });
      }
      if (url.includes("/cuts/")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "plot-01", cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp" })] }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    const btn = await screen.findByTestId("add-text-panel-btn");
    fireEvent.click(btn);

    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT" && c.url.includes("/cuts/"));
      expect(put).toBeTruthy();
      const body = JSON.parse(put!.body as string);
      const added = body.cuts.find((c: { kind?: string }) => c.kind === "text");
      expect(added).toBeTruthy();
      expect(added.id).toBe(2); // appended after the existing image cut
    });
  });
});

describe("CutListPanel self-guiding workflow copy (#360)", () => {
  it("shows the writer-facing workflow help and a reader-facing 'Add narration/text panel' action (no 'Generate MD'/'markdown')", async () => {
    const authFetch = makeFetch([makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp" })]);
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    const help = await screen.findByTestId("cut-workspace-tools");
    // Explains the order of operations and what a text panel is, in plain terms.
    expect(help.textContent).toMatch(/Add narration\/text panel/);
    expect(help.textContent).toMatch(/solid card exported as a final image/i);

    const addBtn = screen.getByTestId("add-text-panel-btn");
    expect(addBtn).toHaveTextContent("Add narration/text panel");

    const prepBtn = screen.getByTestId("generate-markdown-btn");
    expect(prepBtn).toHaveTextContent("Prepare episode for publish");
    // No internal "Generate MD"/"markdown" jargon in the visible primary actions.
    expect(addBtn.textContent).not.toMatch(/Generate MD|markdown/i);
    expect(prepBtn.textContent).not.toMatch(/Generate MD|markdown/i);
  });
});
