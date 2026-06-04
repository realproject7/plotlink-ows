// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

beforeAll(() => {
  installObjectUrlStub();
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

beforeEach(() => { Object.assign(navigator, { clipboard: { writeText: vi.fn() } }); });
afterEach(cleanup);

// A Genesis coach whose primary action is an in-app lettering step.
const genesisCoach = {
  stageLabel: "Clean images ready", action: "Review cuts and start lettering",
  actionKind: "ui", prompt: null, uiAction: "open-lettering", episodeFile: "genesis.md",
};

const genesisCut = {
  id: 1, shotType: "medium", description: "Scene", characters: [], dialogue: [], narration: "", sfx: "",
  cleanImagePath: "assets/genesis/cut-01-clean.webp", finalImagePath: null, exportedAt: null,
  uploadedCid: null, uploadedUrl: null, overlays: [],
};

function makeAuthFetch() {
  return vi.fn((url: string) => {
    if (url.includes("/asset/")) {
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"], { type: "image/webp" })) });
    }
    let data: unknown = {};
    if (url.includes("/progress")) data = { contentType: "cartoon", coach: genesisCoach };
    else if (url.includes("/cuts/genesis/detect-clean-images")) data = { detected: [], stale: [] };
    else if (url.includes("/cuts/genesis/asset-diagnostics")) data = { diagnostics: [], summary: {} };
    else if (url.includes("/cuts/genesis")) data = { version: 1, plotFile: "genesis", cuts: [genesisCut] };
    else if (url.includes("/cover-asset")) data = { found: false };
    else if (url.endsWith("/genesis.md")) data = { file: "genesis.md", status: "pending", content: "# Opening\n\nThe story begins." };
    else if (url.endsWith("/structure.md")) data = { content: "# Bible" };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  });
}

describe("PreviewPanel — Genesis workflow-coach cut actions (#429)", () => {
  it("a Genesis coach UI action lands on the actionable cut workspace, not the markdown editor", async () => {
    render(<PreviewPanel storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch()} contentType="cartoon" hasGenesis />);

    // The coach loads for Genesis with an in-app (lettering) action.
    const doBtn = await screen.findByTestId("workflow-coach-do");
    expect(doBtn).toHaveTextContent(/lettering/i);
    // Before acting, the cut workspace isn't mounted.
    expect(screen.queryByTestId("cut-list-panel")).not.toBeInTheDocument();

    fireEvent.click(doBtn);

    // After: the Genesis cut workspace is mounted and actionable — NOT the
    // plain markdown textarea (the bug @re1 caught).
    expect(await screen.findByTestId("cut-list-panel")).toBeInTheDocument();
  });

  it("Genesis Edit tab keeps the opening-text editor and reaches the cut workspace via the sub-toggle", async () => {
    render(<PreviewPanel storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch()} contentType="cartoon" hasGenesis />);
    await screen.findByTestId("workflow-coach"); // wait for first render to settle

    fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
    // Default Genesis Edit sub-view is the opening-text editor (prose preserved).
    expect(await screen.findByTestId("genesis-edit-mode-text")).toBeInTheDocument();
    expect(screen.queryByTestId("cut-list-panel")).not.toBeInTheDocument();

    // The cut workspace is reachable via the "Cuts" sub-toggle.
    fireEvent.click(screen.getByTestId("genesis-edit-mode-cuts"));
    expect(await screen.findByTestId("cut-list-panel")).toBeInTheDocument();
  });
});
