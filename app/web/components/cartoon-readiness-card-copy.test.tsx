import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CARTOON_BUBBLE_RENDERER_VERSION } from "@app-lib/overlays";
import { PreviewPanel } from "./PreviewPanel";

// #345: the "Episode prepared for publish" (awaiting-upload) card's next-action
// line must track the CURRENT cartoon step — once clean/letter/export are done
// it should say "upload …", not the generic full-sequence copy.
beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

// Marker block exists (so it's not the planning stage) but carries no uploaded
// image → awaiting-upload stage.
const SKELETON_MD = "<!-- ows:cartoon-cut cut-001 start -->\n<!-- Cut 1: awaiting upload -->\n<!-- ows:cartoon-cut cut-001 end -->";

// A cut that is clean + lettered + exported, but NOT yet uploaded.
const EXPORTED_CUT = {
  id: 1, shotType: "medium", description: "Opening", characters: [],
  dialogue: [], narration: "", sfx: "",
  cleanImagePath: "assets/plot-01/cut-01-clean.webp",
  finalImagePath: "assets/plot-01/cut-01-final.webp",
  exportedAt: "2026-01-01T00:00:00Z",
  uploadedCid: null, uploadedUrl: null,
  finalRendererVersion: CARTOON_BUBBLE_RENDERER_VERSION,
  overlays: [{ id: "o1", type: "speech", x: 0.1, y: 0.2, width: 0.25, height: 0.12, text: "Hi", speaker: "Mira", tailAnchor: { x: 0.5, y: 1.2 } }],
};

function makeFetch(cut: Record<string, unknown>) {
  return vi.fn((url: string) => {
    if (url.includes("/cuts/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "plot-01", cuts: [cut] }) });
    }
    if (url.endsWith("/plot-01.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: SKELETON_MD }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: "" }) });
  });
}

describe("cartoon awaiting-upload card next-action copy (#345)", () => {
  it("says 'upload …' (not the generic add/letter/export copy) when only upload remains", async () => {
    render(
      <PreviewPanel storyName="story" fileName="plot-01.md" authFetch={makeFetch(EXPORTED_CUT)} onPublish={vi.fn()} publishingFile={null} contentType="cartoon" />,
    );
    const card = await screen.findByTestId("cartoon-awaiting-upload");
    const next = await screen.findByTestId("cartoon-awaiting-next");
    // Aligned with the current step: upload.
    expect(next).toHaveTextContent(/upload the exported final images/i);
    // No longer the generic full-sequence copy.
    expect(next.textContent).not.toMatch(/add clean images, letter the bubbles/i);
    // And it matches the Episode steps panel's next-step line (single source).
    expect(screen.getByTestId("cartoon-next-step")).toHaveTextContent(/upload the exported final images/i);
    expect(card).toBeInTheDocument();
  });

  it("still guides clean-image creation when no clean image exists yet", async () => {
    const planned = { ...EXPORTED_CUT, cleanImagePath: null, finalImagePath: null, exportedAt: null, overlays: [] };
    render(
      <PreviewPanel storyName="story" fileName="plot-01.md" authFetch={makeFetch(planned)} onPublish={vi.fn()} publishingFile={null} contentType="cartoon" />,
    );
    const next = await screen.findByTestId("cartoon-awaiting-next");
    expect(next).toHaveTextContent(/create a clean image for each cut/i);
  });
});
