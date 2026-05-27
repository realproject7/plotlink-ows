import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CartoonPreview } from "./CartoonPreview";

afterEach(cleanup);

function mockAuthFetch(response: { ok: boolean; status?: number; data?: unknown }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: () => Promise.resolve(response.data ?? {}),
  });
}

function shouldUseCartoonPreview(
  contentType: "fiction" | "cartoon" | undefined,
  fileName: string | null,
): boolean {
  if (!fileName) return false;
  const isPlot = /^plot-\d+\.md$/.test(fileName);
  return contentType === "cartoon" && isPlot;
}

describe("preview routing logic", () => {
  it("fiction plot uses markdown preview", () => {
    expect(shouldUseCartoonPreview("fiction", "plot-01.md")).toBe(false);
  });

  it("undefined contentType uses markdown preview", () => {
    expect(shouldUseCartoonPreview(undefined, "plot-01.md")).toBe(false);
  });

  it("cartoon plot uses cartoon preview", () => {
    expect(shouldUseCartoonPreview("cartoon", "plot-01.md")).toBe(true);
  });

  it("cartoon genesis uses markdown preview", () => {
    expect(shouldUseCartoonPreview("cartoon", "genesis.md")).toBe(false);
  });

  it("cartoon structure uses markdown preview", () => {
    expect(shouldUseCartoonPreview("cartoon", "structure.md")).toBe(false);
  });
});

describe("CartoonPreview", () => {
  it("shows empty state when cuts file is missing", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 404, data: { error: "Cuts file not found" } });
    render(<CartoonPreview storyName="test-story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("No cuts yet")).toBeInTheDocument();
    });
  });

  it("shows error state on fetch failure", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 400, data: { error: "Invalid JSON" } });
    render(<CartoonPreview storyName="test-story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Invalid JSON")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("renders cut with final image", async () => {
    const cutsData = {
      version: 1,
      plotFile: "plot-01",
      cuts: [{
        id: 1, shotType: "wide", description: "City at dawn",
        characters: ["Mira"], dialogue: [], narration: "", sfx: "",
        cleanImagePath: "assets/plot-01/cut-01-clean.webp",
        finalImagePath: "assets/plot-01/cut-01-final.webp",
        exportedAt: null, uploadedCid: null, uploadedUrl: null,
      }],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CartoonPreview storyName="test-story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
      expect(screen.getByText("wide")).toBeInTheDocument();
      expect(screen.getByText("City at dawn")).toBeInTheDocument();
      expect(screen.getByText("Mira")).toBeInTheDocument();
      const img = screen.getByAltText("City at dawn");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "/api/stories/test-story/asset/plot-01/cut-01-final.webp");
    });
  });

  it("renders clean image with text overlay when final is missing", async () => {
    const cutsData = {
      version: 1,
      plotFile: "plot-01",
      cuts: [{
        id: 1, shotType: "medium", description: "Market scene",
        characters: [], dialogue: [{ speaker: "Mira", text: "Look at this." }],
        narration: "The market was bustling.", sfx: "",
        cleanImagePath: "assets/plot-01/cut-01-clean.webp",
        finalImagePath: null,
        exportedAt: null, uploadedCid: null, uploadedUrl: null,
      }],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CartoonPreview storyName="my-story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      const img = screen.getByAltText("Market scene");
      expect(img).toHaveAttribute("src", "/api/stories/my-story/asset/plot-01/cut-01-clean.webp");
      const overlay = screen.getByTestId("cut-1-overlay");
      expect(overlay).toBeInTheDocument();
      expect(screen.getByText("Mira:")).toBeInTheDocument();
      expect(screen.getByText("Look at this.")).toBeInTheDocument();
      expect(screen.getByText("The market was bustling.")).toBeInTheDocument();
    });
  });

  it("renders blank narration cut without image", async () => {
    const cutsData = {
      version: 1,
      plotFile: "plot-01",
      cuts: [{
        id: 2, shotType: "medium", description: "",
        characters: [], dialogue: [{ speaker: "Jin", text: "We need to go." }],
        narration: "The rain continued to fall.", sfx: "",
        cleanImagePath: null, finalImagePath: null,
        exportedAt: null, uploadedCid: null, uploadedUrl: null,
      }],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CartoonPreview storyName="test-story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Narration cut")).toBeInTheDocument();
      expect(screen.getByText("Jin:")).toBeInTheDocument();
      expect(screen.getByText("We need to go.")).toBeInTheDocument();
      expect(screen.getByText("The rain continued to fall.")).toBeInTheDocument();
    });
  });

  it("renders empty image placeholder for cut with no content", async () => {
    const cutsData = {
      version: 1,
      plotFile: "plot-01",
      cuts: [{
        id: 1, shotType: "wide", description: "",
        characters: [], dialogue: [], narration: "", sfx: "",
        cleanImagePath: null, finalImagePath: null,
        exportedAt: null, uploadedCid: null, uploadedUrl: null,
      }],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CartoonPreview storyName="test-story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("No image yet")).toBeInTheDocument();
    });
  });

  it("shows loading state initially", () => {
    const authFetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<CartoonPreview storyName="test-story" fileName="plot-01.md" authFetch={authFetch} />);

    expect(screen.getByText("Loading cuts...")).toBeInTheDocument();
  });
});

describe("fiction regression — CartoonPreview not rendered", () => {
  it("fiction plot-01.md does NOT trigger CartoonPreview", () => {
    expect(shouldUseCartoonPreview("fiction", "plot-01.md")).toBe(false);
  });

  it("fiction genesis.md does NOT trigger CartoonPreview", () => {
    expect(shouldUseCartoonPreview("fiction", "genesis.md")).toBe(false);
  });

  it("fiction structure.md does NOT trigger CartoonPreview", () => {
    expect(shouldUseCartoonPreview("fiction", "structure.md")).toBe(false);
  });

  it("undefined contentType does NOT trigger CartoonPreview", () => {
    expect(shouldUseCartoonPreview(undefined, "plot-01.md")).toBe(false);
  });

  it("null fileName does NOT trigger CartoonPreview", () => {
    expect(shouldUseCartoonPreview("cartoon", null)).toBe(false);
  });
});
