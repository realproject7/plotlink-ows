import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

// #371: the Cut Inspector shows a direct next-action CTA per cut that jumps to
// the Edit tab and focuses/expands that exact cut — opening the lettering editor
// when there is something to letter, or expanding the row to add clean art. This
// must work for image cuts AND text/interstitial panels, with creator-facing copy.
beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

// cut 1: clean image, not yet lettered → "Letter this cut" (opens editor).
// cut 2: image cut, no clean art, no planned text → "Add clean art" (expand row).
// cut 3: text/interstitial panel → "Letter this cut" (opens editor).
// cut 4: final image present → "Review final panel" (opens editor).
const CUTS = {
  version: 1,
  plotFile: "plot-01",
  cuts: [
    {
      id: 1, shotType: "wide", description: "Rooftop standoff", characters: ["Jin"],
      dialogue: [], narration: "", sfx: "",
      cleanImagePath: "assets/plot-01/cut-01-clean.webp", finalImagePath: null,
      exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [],
    },
    {
      id: 2, shotType: "medium", description: "Alley chase", characters: [],
      dialogue: [], narration: "", sfx: "",
      cleanImagePath: null, finalImagePath: null,
      exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [],
    },
    {
      id: 3, shotType: "wide", description: "Three years later", characters: [],
      dialogue: [], narration: "Three years later.", sfx: "",
      cleanImagePath: null, finalImagePath: null,
      exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [],
      kind: "text", background: "#101820", aspectRatio: "4:5",
    },
    {
      id: 4, shotType: "close-up", description: "The reveal", characters: ["Jin"],
      dialogue: [], narration: "", sfx: "",
      cleanImagePath: "assets/plot-01/cut-04-clean.webp",
      finalImagePath: "assets/plot-01/cut-04-final.webp",
      exportedAt: "2026-01-01", uploadedCid: null, uploadedUrl: null, overlays: [],
    },
  ],
};

const PLOT_MD = "<!-- ows:cartoon-cut cut-001 start -->\n![Scene](https://ipfs/Qm)\n<!-- ows:cartoon-cut cut-001 end -->";

function makeAuthFetch() {
  return vi.fn().mockImplementation((url: string) => {
    // detect-clean-images is matched by /cuts/ too — returning the cuts object is
    // harmless (no `detected` array ⇒ empty set).
    if (url.includes("/cuts/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CUTS) });
    }
    if (url.includes("/asset/")) {
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"], { type: "image/webp" })) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: PLOT_MD }) });
  });
}

function renderInspector() {
  render(<PreviewPanel storyName="story" fileName="plot-01.md" authFetch={makeAuthFetch()} contentType="cartoon" onPublish={vi.fn()} />);
}

async function openInspector() {
  renderInspector();
  await screen.findByTestId("lettering-review-board");
}

describe("Preview→lettering next-action CTA for cartoon cuts (#371)", () => {
  it("shows creator-facing actions per cut on the episode preview board", async () => {
    await openInspector();
    expect(screen.getByTestId("add-bubbles-1")).toHaveTextContent("Open focused editor");
    expect(screen.getByTestId("card-addart-2")).toHaveTextContent("Add artwork");
    expect(screen.getByTestId("cut-preview-3")).toBeInTheDocument();
    expect(screen.getByTestId("cut-preview-4")).toBeInTheDocument();
    for (const id of [1, 2, 3, 4]) {
      expect(screen.getByTestId(`cut-card-${id}`).textContent ?? "").not.toMatch(/markdown|generate md|cuts\.json|schema/i);
    }
  });

  it("clicking the lettering action on a clean image cut opens the focused editor", async () => {
    await openInspector();
    fireEvent.click(screen.getByTestId("add-bubbles-1"));
    await screen.findByTestId("editor-surface");
  });

  it("clicking the lettering action on a text/interstitial panel opens its editor too", async () => {
    await openInspector();
    fireEvent.click(screen.getByTestId("cut-preview-3"));
    await screen.findByTestId("editor-surface");
  });

  it("clicking Add artwork expands the cut row without opening the editor", async () => {
    await openInspector();
    fireEvent.click(screen.getByTestId("card-addart-2"));
    await screen.findByTestId("cut-list-panel");
    await waitFor(() => expect(screen.getByText("Upload clean image")).toBeInTheDocument());
    expect(screen.queryByTestId("editor-surface")).not.toBeInTheDocument();
  });

  it("Review cut on a finished cut opens its editor for review", async () => {
    await openInspector();
    fireEvent.click(screen.getByTestId("cut-preview-4"));
    await screen.findByTestId("editor-surface");
  });
});
