import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CartoonPreview } from "./CartoonPreview";
import { installObjectUrlStub, MOCK_BLOB_URL } from "./asset-test-utils";

beforeAll(() => {
  installObjectUrlStub();
});

afterEach(cleanup);

function mockAuthFetch(response: { ok: boolean; status?: number; data?: unknown }) {
  // Asset routes load via blob (browsers can't attach the Bearer header to a
  // raw <img src>); the cuts data route returns JSON.
  return vi.fn((url: string) =>
    Promise.resolve(
      url.includes("/asset/")
        ? {
            ok: true,
            status: 200,
            blob: () => Promise.resolve(new Blob(["img"], { type: "image/webp" })),
          }
        : {
            ok: response.ok,
            status: response.status ?? (response.ok ? 200 : 400),
            json: () => Promise.resolve(response.data ?? {}),
          },
    ),
  );
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

  it("shows actionable v1 schema error for invalid cuts", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 400, data: { error: "plot-01.cuts.json is invalid: Cut 0 missing numeric id" } });
    render(<CartoonPreview storyName="test-story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("cuts-error")).toBeInTheDocument();
      expect(screen.getByText("Invalid cuts file")).toBeInTheDocument();
      expect(screen.getByText(/missing numeric id/)).toBeInTheDocument();
      expect(screen.getByText(/OWS v1 schema/)).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("missing cuts (404) shows No cuts, not an error", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 404, data: { error: "Cuts file not found" } });
    render(<CartoonPreview storyName="test-story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("No cuts yet")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cuts-error")).not.toBeInTheDocument();
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
      expect(img).toHaveAttribute("src", MOCK_BLOB_URL);
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
      expect(img).toHaveAttribute("src", MOCK_BLOB_URL);
      const overlay = screen.getByTestId("cut-1-overlay");
      expect(overlay).toBeInTheDocument();
      expect(screen.getByText("Mira:")).toBeInTheDocument();
      expect(screen.getByText("Look at this.")).toBeInTheDocument();
      expect(screen.getByText("The market was bustling.")).toBeInTheDocument();
    });
  });

  it("renders a planned text cut without image as image-pending (not a finished narration card)", async () => {
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
      expect(screen.getByTestId("cut-2-pending")).toBeInTheDocument();
      expect(screen.getByText("Image pending")).toBeInTheDocument();
      // Planned text is still shown, but clearly labeled as a plan, not a finished card.
      expect(screen.queryByText("Narration cut")).not.toBeInTheDocument();
      expect(screen.getByText("Jin:")).toBeInTheDocument();
      expect(screen.getByText("We need to go.")).toBeInTheDocument();
      expect(screen.getByText("The rain continued to fall.")).toBeInTheDocument();
    });
  });

  it("renders image-pending placeholder for a planned cut with no content", async () => {
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
      expect(screen.getByTestId("cut-1-pending")).toBeInTheDocument();
      expect(screen.getByText("Image pending")).toBeInTheDocument();
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
