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
  await waitFor(() => expect(screen.getByTestId("cartoon-mode-inspect")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("cartoon-mode-inspect"));
  await screen.findByTestId("cut-1-cta");
}

describe("Preview→lettering next-action CTA for cartoon cuts (#371)", () => {
  it("shows a creator-facing next-action CTA per cut (image cuts and text panels)", async () => {
    await openInspector();
    expect(screen.getByTestId("cut-1-cta")).toHaveTextContent("Letter this cut");
    expect(screen.getByTestId("cut-2-cta")).toHaveTextContent("Add clean art for this cut");
    expect(screen.getByTestId("cut-3-cta")).toHaveTextContent("Letter this cut"); // text panel
    expect(screen.getByTestId("cut-4-cta")).toHaveTextContent("Review final panel");
    // No markdown/schema jargon in any CTA.
    for (const id of [1, 2, 3, 4]) {
      expect(screen.getByTestId(`cut-${id}-cta`).textContent ?? "").not.toMatch(/markdown|generate md|cuts\.json|schema/i);
    }
  });

  it("clicking 'Letter this cut' on a clean image cut jumps to the Edit tab and opens that cut's lettering editor", async () => {
    await openInspector();
    fireEvent.click(screen.getByTestId("cut-1-cta"));
    // The lettering editor for the cut is now mounted (Edit tab content).
    await screen.findByTestId("editor-surface");
    // The Cut Inspector / cut list is no longer shown.
    expect(screen.queryByTestId("cut-1-cta")).not.toBeInTheDocument();
  });

  it("clicking 'Letter this cut' on a text/interstitial panel opens its editor too", async () => {
    await openInspector();
    fireEvent.click(screen.getByTestId("cut-3-cta"));
    await screen.findByTestId("editor-surface");
  });

  it("clicking 'Add clean art for this cut' jumps to the Edit tab and expands that cut's row (no editor)", async () => {
    await openInspector();
    fireEvent.click(screen.getByTestId("cut-2-cta"));
    // Edit tab cut list is shown with cut 2's row expanded (its upload-clean action visible).
    await screen.findByTestId("cut-list-panel");
    await waitFor(() => expect(screen.getByText("Upload clean image")).toBeInTheDocument());
    // The lettering editor is NOT opened for an art-less cut.
    expect(screen.queryByTestId("editor-surface")).not.toBeInTheDocument();
  });

  it("'Review final panel' on a finished cut opens its editor for review", async () => {
    await openInspector();
    fireEvent.click(screen.getByTestId("cut-4-cta"));
    await screen.findByTestId("editor-surface");
  });
});
