import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { CutListPanel } from "./CutListPanel";

afterEach(cleanup);

function mockAuthFetch(response: { ok: boolean; status?: number; data?: unknown }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: () => Promise.resolve(response.data ?? {}),
  });
}

function makeCut(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, shotType: "medium", description: "Test scene",
    characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null,
    exportedAt: null, uploadedCid: null, uploadedUrl: null,
    ...overrides,
  };
}

describe("CutListPanel", () => {
  it("shows empty state when no cuts file", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 404, data: { error: "Not found" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("No cuts yet")).toBeInTheDocument();
    });
  });

  it("shows missing status for cut without clean image", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: null })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("No image")).toBeInTheDocument();
      expect(screen.getByText("1 missing")).toBeInTheDocument();
    });
  });

  it("shows clean status for cut with clean image", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Clean ready")).toBeInTheDocument();
      expect(screen.getByText("1 clean")).toBeInTheDocument();
    });
  });

  it("shows lettered status for cut with finalImagePath", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({
        id: 1,
        cleanImagePath: "assets/plot-01/cut-01-clean.webp",
        finalImagePath: "assets/plot-01/cut-01-final.webp",
      })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Lettered")).toBeInTheDocument();
      expect(screen.getByText("1 lettered")).toBeInTheDocument();
    });
  });

  it("shows uploaded status for cut with uploadedCid", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, uploadedCid: "QmTest", cleanImagePath: "x.webp" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Uploaded")).toBeInTheDocument();
      expect(screen.getByText("1 uploaded")).toBeInTheDocument();
    });
  });

  it("expands cut to show upload button", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, description: "Wide city shot" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Wide city shot")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Wide city shot"));

    await waitFor(() => {
      expect(screen.getByText("Upload clean image")).toBeInTheDocument();
    });
  });

  it("shows replace button when clean image exists", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp", description: "Scene" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Scene"));

    await waitFor(() => {
      expect(screen.getByText("Replace clean image")).toBeInTheDocument();
    });
  });

  it("calls upload endpoint when file is selected", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, description: "Upload test" })],
    };
    const authFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cutsData) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, cleanImagePath: "assets/plot-01/cut-01-clean.webp" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({
        ...cutsData,
        cuts: [{ ...cutsData.cuts[0], cleanImagePath: "assets/plot-01/cut-01-clean.webp" }],
      }) });

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Upload test")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Upload test"));
    await waitFor(() => expect(screen.getByText("Upload clean image")).toBeInTheDocument());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["img"], "test.webp", { type: "image/webp" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith(
        "/api/stories/story/cuts/plot-01/upload-clean/1",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("shows error state on fetch failure", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 400, data: { error: "Bad data" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Bad data")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });
});
