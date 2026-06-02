import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

// #360: when a cartoon episode is publish-blocked in the "error" stage, the
// publish panel groups the readiness issues by workflow step (with a writer-facing
// heading) instead of listing a flat wall of repeated per-cut technical errors.
beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

// A fully-lettered/uploaded cut whose marker block references a DIFFERENT url
// than its recorded uploadedUrl → a genuine (non-awaiting) image-reference error,
// so classifyCartoonReadiness resolves to the "error" stage.
const CONTENT = "<!-- ows:cartoon-cut cut-001 start -->\n![c](https://bad)\n<!-- ows:cartoon-cut cut-001 end -->";
function mismatchedCut() {
  return {
    id: 1, shotType: "wide", description: "d", characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: "assets/plot-01/cut-01-clean.webp", finalImagePath: "assets/plot-01/cut-01-final.webp",
    exportedAt: "2026-01-01", uploadedCid: "Qm", uploadedUrl: "https://good", overlays: [{ id: "1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }],
  };
}

function makeFetch() {
  return vi.fn((url: string) => {
    if (url.endsWith("/cover-asset")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ found: false }) });
    }
    if (url.endsWith("/structure.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: "" }) });
    }
    if (url.includes("/cuts/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "plot-01", title: "The Couple Coupon", cuts: [mismatchedCut()] }) });
    }
    if (url.endsWith("/plot-01.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: "plot-01.md", status: "pending", content: CONTENT }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("cartoon grouped publish-readiness messaging (#360)", () => {
  it("renders issues grouped by workflow step instead of a flat per-cut list", async () => {
    render(<PreviewPanel storyName="coupon-crush" fileName="plot-01.md" authFetch={makeFetch()} onPublish={vi.fn()} publishingFile={null} walletAddress="test-wallet-address" contentType="cartoon" />);

    const container = await screen.findByTestId("cartoon-publish-issues");
    // A grouped heading (workflow step), not a flat error dump.
    const group = await screen.findByTestId("cartoon-issue-group-images");
    expect(group).toBeInTheDocument();
    expect(group).toHaveTextContent("Fix image references");
    // The underlying technical detail is still present, nested under the step.
    expect(container.textContent).toMatch(/does not match the recorded uploaded URL/);
    // Publish is blocked while in the error stage.
    expect(screen.getByText("Publish to PlotLink").closest("button")).toBeDisabled();
  });
});
