import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CartoonPreview } from "./CartoonPreview";

afterEach(cleanup);

function makeCutsFetch(cuts: unknown[]) {
  return vi.fn().mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "plot-01", cuts }) }),
  );
}

const plannedTextCut = {
  id: 1, shotType: "wide", description: "Opening", characters: [],
  dialogue: [{ speaker: "Mira", text: "We're here." }], narration: "Dawn breaks.", sfx: "",
  cleanImagePath: null, finalImagePath: null,
  exportedAt: null, uploadedCid: null, uploadedUrl: null,
};

describe("CartoonPreview planned-cut rendering", () => {
  it("shows a cut with no image as image-pending, not a finished narration card", async () => {
    const authFetch = makeCutsFetch([plannedTextCut]);
    render(<CartoonPreview storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("cut-1-pending")).toBeInTheDocument();
    });
    expect(screen.getByText("Image pending")).toBeInTheDocument();
    // The old "Narration cut" finished-card label must not be used for a planned cut.
    expect(screen.queryByText("Narration cut")).not.toBeInTheDocument();
    // Planned text is still shown, clearly labeled as a plan.
    expect(screen.getByText(/Planned text/)).toBeInTheDocument();
  });

  it("does not render the pending placeholder when a clean image exists", async () => {
    const authFetch = makeCutsFetch([
      { ...plannedTextCut, cleanImagePath: "assets/plot-01/cut-01-clean.webp" },
    ]);
    render(<CartoonPreview storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.queryByTestId("cut-1-pending")).not.toBeInTheDocument();
    });
  });

  // #351: an intentional text/interstitial panel is NOT "Image pending".
  it("renders a text panel as an intentional panel, not image-pending", async () => {
    const authFetch = makeCutsFetch([{ ...plannedTextCut, kind: "text", background: "#101820" }]);
    render(<CartoonPreview storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByTestId("cut-1-textpanel")).toBeInTheDocument());
    expect(screen.queryByTestId("cut-1-pending")).not.toBeInTheDocument();
    expect(screen.getByText("Text panel")).toBeInTheDocument();
    expect(screen.queryByText("Image pending")).not.toBeInTheDocument();
  });
});
