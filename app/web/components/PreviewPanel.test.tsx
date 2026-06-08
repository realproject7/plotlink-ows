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

function makeGenerateMarkdownAuthFetch() {
  const calls: string[] = [];
  const fn = vi.fn((url: string) => {
    calls.push(url);
    if (url.includes("/asset/")) {
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"], { type: "image/webp" })) });
    }
    let data: unknown = {};
    if (url.includes("/progress")) data = { contentType: "cartoon", coach: genesisCoach };
    else if (url.includes("/cuts/genesis/generate-markdown")) data = { ok: true };
    else if (url.includes("/cuts/genesis/detect-clean-images")) data = { detected: [], stale: [] };
    else if (url.includes("/cuts/genesis/asset-diagnostics")) data = { diagnostics: [], summary: {} };
    else if (url.includes("/cuts/genesis")) data = { version: 1, plotFile: "genesis", cuts: [genesisCut] };
    else if (url.includes("/cover-asset")) data = { found: false };
    else if (url.endsWith("/genesis.md")) data = { file: "genesis.md", status: "pending", content: "# Opening\n\nThe story begins." };
    else if (url.endsWith("/structure.md")) data = { content: "# Bible" };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  });
  return { fn, calls };
}

describe("PreviewPanel — cartoon file chrome", () => {
  it("does not render the old top workflow coach in cartoon file views (#498)", async () => {
    render(<PreviewPanel storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch()} contentType="cartoon" hasGenesis />);
    expect(await screen.findByTestId("cut-list-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("workflow-coach")).not.toBeInTheDocument();
  });

  it("Cartoon episode Preview shows the cut board and Edit opens the focused lettering editor", async () => {
    render(<PreviewPanel storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch()} contentType="cartoon" hasGenesis />);
    expect(await screen.findByTestId("cut-list-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
    expect(await screen.findByTestId("focused-lettering-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("genesis-edit-mode-text")).not.toBeInTheDocument();
    expect(screen.queryByTestId("genesis-edit-mode-cuts")).not.toBeInTheDocument();
  });

  it("merges the cartoon episode file label and markdown title into one compact header row", async () => {
    render(<PreviewPanel storyName="god-cell" fileName="genesis.md" authFetch={makeAuthFetch()} contentType="cartoon" hasGenesis />);
    expect(await screen.findByTestId("cut-list-panel")).toBeInTheDocument();

    expect(screen.getByText("epi-01 (Genesis) · Episode 1 — Opening")).toBeInTheDocument();
  });

  it("keeps cartoon episode Preview/Edit as cut board and focused editor after repeated switches", async () => {
    render(
      <PreviewPanel
        storyName="god-cell"
        fileName="genesis.md"
        authFetch={makeAuthFetch()}
        contentType="cartoon"
        hasGenesis
      />,
    );

    await screen.findByTestId("cut-list-panel");

    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
      expect(await screen.findByTestId("focused-lettering-editor")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^Preview/ }));
      expect(await screen.findByTestId("cut-list-panel")).toBeInTheDocument();
    }
  });

  it("applies an open-lettering workflow request by landing in Genesis cuts edit", async () => {
    render(
      <PreviewPanel
        storyName="god-cell"
        fileName="genesis.md"
        authFetch={makeAuthFetch()}
        contentType="cartoon"
        hasGenesis
        workflowActionRequest={{ action: "open-lettering", seq: 1 }}
      />,
    );

    expect(await screen.findByTestId("focused-lettering-editor")).toBeInTheDocument();
  });

  it("applies a generate-markdown workflow request through the generation endpoint", async () => {
    const { fn, calls } = makeGenerateMarkdownAuthFetch();
    render(
      <PreviewPanel
        storyName="god-cell"
        fileName="genesis.md"
        authFetch={fn}
        contentType="cartoon"
        hasGenesis
        workflowActionRequest={{ action: "generate-markdown", seq: 1 }}
      />,
    );

    await screen.findByTestId("cut-list-panel");
    expect(
      calls.some((url) => url.includes("/cuts/genesis/generate-markdown")),
    ).toBe(true);
  });
});
