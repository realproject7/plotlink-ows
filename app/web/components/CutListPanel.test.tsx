import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { CutListPanel } from "./CutListPanel";
import { installObjectUrlStub, MOCK_BLOB_URL } from "./asset-test-utils";
import { CARTOON_BUBBLE_RENDERER_VERSION } from "@app-lib/overlays";

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

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
});

afterEach(cleanup);

function mockAuthFetch(response: { ok: boolean; status?: number; data?: unknown }) {
  return vi.fn((url: string) =>
    Promise.resolve(
      url.includes("/asset/")
        ? { ok: true, status: 200, blob: () => Promise.resolve(new Blob(["img"], { type: "image/webp" })) }
        : {
            ok: response.ok,
            status: response.status ?? (response.ok ? 200 : 400),
            json: () => Promise.resolve(response.data ?? {}),
          },
    ),
  );
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

  it("keeps later cuts selectable after another row is expanded", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: Array.from({ length: 10 }, (_, i) => makeCut({
        id: i + 1,
        description: `Cut ${i + 1} scene`,
        cleanImagePath: `assets/plot-01/cut-${String(i + 1).padStart(2, "0")}-clean.webp`,
      })),
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="coupon-crush" fileName="plot-01.md" authFetch={authFetch} />);

    const scroll = await screen.findByTestId("cut-list-scroll");
    expect(scroll).toHaveClass("min-h-56");

    fireEvent.click(screen.getByText("Cut 1 scene"));
    await waitFor(() => expect(screen.getByTestId("open-editor-1")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Cut 9 scene"));

    await waitFor(() => {
      expect(screen.queryByTestId("open-editor-1")).not.toBeInTheDocument();
      expect(screen.getByTestId("open-editor-9")).toBeInTheDocument();
    });
  });

  it("shows the clean-image handoff helper and Copy prompt button for a cut with no clean image", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, description: "Wide city shot" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Wide city shot")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Wide city shot"));

    await waitFor(() => {
      expect(screen.getByTestId("clean-image-handoff-1")).toBeInTheDocument();
      expect(screen.getByText(/Generate externally, then upload or import the clean image/)).toBeInTheDocument();
      expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument();
      // existing upload control still renders
      expect(screen.getByText("Upload clean image")).toBeInTheDocument();
    });
  });

  it("Copy prompt copies an actionable Codex task (output path + create-file + visual prompt)", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, shotType: "wide", description: "Rainy alley", characters: ["Mira"] })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Rainy alley")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Rainy alley"));

    await waitFor(() => expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("copy-prompt-1"));

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // Actionable Codex task content (the #267 deliverable):
    expect(copied).toContain("assets/plot-01/cut-01-clean.webp");
    expect(copied).toContain("SAVE IT AS AN ACTUAL FILE");
    expect(copied).toContain("VERIFY the file exists");
    expect(copied).toContain("under 1MB");
    expect(copied).toContain("final lettering and upload happen later");
    // The pure visual prompt is still embedded (no scene detail lost):
    expect(copied).toContain("Wide shot. Rainy alley");
    expect(copied).toContain("Characters: Mira.");
    expect(copied).toContain("No speech bubbles");
    await waitFor(() => expect(screen.getByText("Copied!")).toBeInTheDocument());
  });

  it("does not show the handoff helper once a clean image exists", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp", description: "Has image" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Has image")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Has image"));

    await waitFor(() => expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument());
    expect(screen.queryByTestId("clean-image-handoff-1")).not.toBeInTheDocument();
  });

  it("renders the expanded clean-image preview via an authFetch blob URL, not the raw protected URL", async () => {
    // Regression for #276: the cut-list preview also rendered a raw
    // <img src="/api/stories/.../asset/...">, which can't carry the bearer
    // header and 401s. It must load through authFetch like the other surfaces.
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp", description: "Has image" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Has image")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Has image"));

    const img = await screen.findByAltText("Cut 1 clean");
    expect(img).toHaveAttribute("src", MOCK_BLOB_URL);
    expect(img.getAttribute("src")).not.toContain("/api/stories/");
    expect(authFetch).toHaveBeenCalledWith("/api/stories/story/asset/plot-01/cut-01-clean.webp");
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

  it("passes language to editor for non-English cartoon", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp", description: "Korean scene", overlays: [{
        id: "kr-overlay", type: "speech", x: 0.1, y: 0.1, width: 0.25, height: 0.12,
        text: "안녕", speaker: "주인공",
      }] })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} language="Korean" />);

    await waitFor(() => expect(screen.getByText("Korean scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Korean scene"));
    await waitFor(() => expect(screen.getByText("Open editor")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Open editor"));

    // Simulate image load in editor — the clean image loads asynchronously via
    // authFetch -> blob -> object URL, so await the <img> before firing load.
    const img = await screen.findByRole("img");
    Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
    act(() => { fireEvent.load(img); });

    // Click the overlay to see inspector font
    await waitFor(() => expect(screen.getByTestId("overlay-kr-overlay")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("overlay-kr-overlay"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-font")).toHaveTextContent("Noto Sans KR");
    });
  });

  it("shows Upload & Generate button when cuts have final images", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "assets/plot-01/cut-01-final.webp", overlays: [] })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("upload-generate-btn")).toBeInTheDocument();
      expect(screen.getByTestId("upload-generate-btn")).not.toBeDisabled();
    });
  });

  it("disables Upload & Generate when all cuts are already uploaded", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "x.webp", uploadedCid: "QmDone", uploadedUrl: "https://done", overlays: [] })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("upload-generate-btn")).toBeDisabled();
    });
  });

  it("Upload & Prepare button exposes no markdown/MD jargon in its label or hover title (#360)", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "assets/plot-01/cut-01-final.webp", overlays: [] })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    const btn = await screen.findByTestId("upload-generate-btn");
    const jargon = /markdown|\bMD\b|Generate MD/i;
    expect(btn.textContent || "").not.toMatch(jargon);
    expect(btn.getAttribute("title") || "").not.toMatch(jargon);
  });

  it("Upload & Prepare progress copy uses creator-facing language, not markdown jargon (#360)", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "assets/plot-01/cut-01-final.webp", overlays: [] })],
    };
    // Hold generate-markdown unresolved so the "Preparing…" progress copy stays rendered.
    let releaseMd: () => void = () => {};
    const mdGate = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) => {
      releaseMd = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, warnings: [] }) });
    });
    const authFetch = vi.fn((url: string) => {
      if (url.endsWith("/detect-clean-images")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [] }) });
      if (url.includes("/asset/")) return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob([new Uint8Array(10)], { type: "image/webp" })) });
      if (url === "/api/publish/upload-plot-image") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cid: "QmNewCid123", url: "https://ipfs.example.com/QmNewCid123" }) });
      if (url.includes("set-uploaded")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      if (url.includes("generate-markdown")) return mdGate;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });
    });

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
    fireEvent.click(await screen.findByTestId("upload-generate-btn"));

    // While generate-markdown is in flight, the progress copy is shown in the button.
    await waitFor(() => {
      expect(screen.getByTestId("upload-generate-btn").textContent || "").toMatch(/Preparing episode for publishing/i);
    });
    expect(screen.getByTestId("upload-generate-btn").textContent || "").not.toMatch(/markdown|\bMD\b/i);
    releaseMd();
  });

  it("Upload & Generate calls upload-plot-image, forwards CID to set-uploaded, then generate-markdown", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "assets/plot-01/cut-01-final.webp", overlays: [] })],
    };
    // URL-aware mock (order-independent: a detect-clean-images fetch also fires on mount).
    const authFetch = vi.fn((url: string) => {
      if (url.endsWith("/detect-clean-images")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [] }) });
      if (url.includes("/asset/")) return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob([new Uint8Array(10)], { type: "image/webp" })) });
      if (url === "/api/publish/upload-plot-image") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cid: "QmNewCid123", url: "https://ipfs.example.com/QmNewCid123" }) });
      if (url.includes("set-uploaded")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      if (url.includes("generate-markdown")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, warnings: [] }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });
    });

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByTestId("upload-generate-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("upload-generate-btn"));

    await waitFor(() => {
      const calls = authFetch.mock.calls;
      const urls = calls.map((c: [string]) => c[0]);

      expect(urls).toContain("/api/stories/story/asset/plot-01/cut-01-final.webp");
      expect(urls.some((u: string) => u === "/api/publish/upload-plot-image")).toBe(true);

      const setUploadedCall = calls.find((c: [string, RequestInit?]) => typeof c[0] === "string" && c[0].includes("set-uploaded"));
      expect(setUploadedCall).toBeTruthy();
      const setUploadedBody = JSON.parse(setUploadedCall![1]?.body as string);
      expect(setUploadedBody.cid).toBe("QmNewCid123");
      expect(setUploadedBody.url).toBe("https://ipfs.example.com/QmNewCid123");

      expect(urls.some((u: string) => u.includes("generate-markdown"))).toBe(true);
    });
  });

  it("retries a rate-limited cut upload then records it (no batch failure) (#288)", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "assets/plot-01/cut-01-final.webp", overlays: [] })],
    };
    let uploadCalls = 0;
    const authFetch = vi.fn((url: string) => {
      if (url.endsWith("/detect-clean-images")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [] }) });
      if (url.includes("/asset/")) return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob([new Uint8Array(10)], { type: "image/webp" })) });
      if (url === "/api/publish/upload-plot-image") {
        uploadCalls += 1;
        // First attempt is rate-limited (the OWS route forwards PlotLink's
        // limit as a 500 with the upstream message); the retry succeeds.
        if (uploadCalls === 1) {
          return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "Rate limit exceeded. Max 5 uploads per minute." }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cid: "QmRetryOk", url: "https://ipfs.example.com/QmRetryOk" }) });
      }
      if (url.includes("set-uploaded")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      if (url.includes("generate-markdown")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, warnings: [] }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });
    });

    render(
      <CutListPanel
        storyName="story"
        fileName="plot-01.md"
        authFetch={authFetch}
        uploadRetry={{ sleep: () => Promise.resolve(), baseDelayMs: 0 }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("upload-generate-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("upload-generate-btn"));

    await waitFor(() => {
      // Uploaded twice (rate-limited then retried), then recorded with the
      // successful retry's CID, then markdown generated — batch did not fail.
      expect(uploadCalls).toBe(2);
      const calls = authFetch.mock.calls;
      const setUploadedCall = calls.find((c: [string, RequestInit?]) => typeof c[0] === "string" && c[0].includes("set-uploaded"));
      expect(setUploadedCall).toBeTruthy();
      expect(JSON.parse(setUploadedCall![1]?.body as string).cid).toBe("QmRetryOk");
      expect(calls.some((c: [string]) => c[0].includes("generate-markdown"))).toBe(true);
    });
  });

  it("reports the affected cut and reason when rate-limit retries are exhausted (#288)", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 3, finalImagePath: "assets/plot-01/cut-03-final.webp", overlays: [] })],
    };
    let uploadCalls = 0;
    const authFetch = vi.fn((url: string) => {
      if (url.endsWith("/detect-clean-images")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [] }) });
      if (url.includes("/asset/")) return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob([new Uint8Array(10)], { type: "image/webp" })) });
      if (url === "/api/publish/upload-plot-image") { uploadCalls += 1; return Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: "Rate limit exceeded. Max 5 uploads per minute." }) }); }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });
    });

    render(
      <CutListPanel
        storyName="story"
        fileName="plot-01.md"
        authFetch={authFetch}
        uploadRetry={{ sleep: () => Promise.resolve(), baseDelayMs: 0, maxRetries: 2 }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("upload-generate-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("upload-generate-btn"));

    await waitFor(() => {
      // Affected cut number + the rate-limit reason are surfaced; markdown is NOT generated.
      const warning = screen.getByText(/Cut 3: upload failed — Rate limit exceeded/);
      expect(warning).toBeInTheDocument();
      expect(uploadCalls).toBe(3); // initial + 2 retries before giving up
      expect(authFetch.mock.calls.some((c: [string]) => c[0].includes("generate-markdown"))).toBe(false);
    });
  });

  it("shows a Sync clean images button that POSTs sync-clean-images then reloads", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, description: "Sync scene" })],
    };
    // URL-aware mock so the extra detect-clean-images fetch on mount/after-sync
    // does not disturb call ordering.
    const authFetch = vi.fn((url: string) => {
      if (url.endsWith("/detect-clean-images")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [] }) });
      if (url.endsWith("/sync-clean-images")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, changed: true, synced: [1], rejected: [] }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });
    });

    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByTestId("sync-clean-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("sync-clean-btn"));

    await waitFor(() => {
      const urls = authFetch.mock.calls.map((c: [string]) => c[0]);
      expect(urls.some((u: string) => u.includes("/sync-clean-images"))).toBe(true);
      // reload happened (GET cuts called at least twice total)
      expect(urls.filter((u: string) => u === "/api/stories/story/cuts/plot-01").length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("Synced 1"));
  });

  it("missing cut shows Copy prompt, Ask Codex and Upload affordances", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, description: "Missing scene" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Missing scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Missing scene"));

    await waitFor(() => {
      expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument();
      expect(screen.getByTestId("ask-codex-1")).toBeInTheDocument();
      expect(screen.getByTestId("ask-codex-copy-1")).toBeInTheDocument();
      expect(screen.getByText("Upload clean image")).toBeInTheDocument();
    });
  });

  it("does not show Ask Codex affordance once a clean image exists", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp", description: "Has clean" })],
    };
    const authFetch = mockAuthFetch({ ok: true, data: cutsData });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Has clean")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Has clean"));

    await waitFor(() => expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument());
    expect(screen.queryByTestId("ask-codex-1")).not.toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 400, data: { error: "Bad data" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Bad data")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("shows actionable v1 schema guidance for invalid cuts (wrong schema)", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 400, data: { error: "plot-01.cuts.json is invalid: Cut 0 has invalid shotType" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("cuts-error")).toBeInTheDocument();
      expect(screen.getByText("Invalid cuts file")).toBeInTheDocument();
      expect(screen.getByText(/invalid shotType/)).toBeInTheDocument();
      expect(screen.getByText(/OWS v1 schema/)).toBeInTheDocument();
    });
  });

  it("shows actionable error for invalid JSON", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 400, data: { error: "plot-01.cuts.json contains invalid JSON" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText(/contains invalid JSON/)).toBeInTheDocument();
      expect(screen.getByText(/OWS v1 schema/)).toBeInTheDocument();
    });
  });

  it("missing cuts file (404) shows No cuts, not an error", async () => {
    const authFetch = mockAuthFetch({ ok: false, status: 404, data: { error: "Cuts file not found" } });
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => {
      expect(screen.getByText("No cuts yet")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cuts-error")).not.toBeInTheDocument();
  });

  // URL-aware fetch mock: cuts vs detect-clean-images vs sync-clean-images.
  function makeRouteFetch(cuts: unknown[], detected: number[]) {
    return vi.fn((url: string) => {
      let data: unknown = {};
      if (url.endsWith("/detect-clean-images")) data = { detected };
      else if (url.endsWith("/sync-clean-images")) data = { ok: true, changed: true, synced: detected, rejected: [] };
      else data = { version: 1, plotFile: "plot-01", cuts };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
    });
  }

  it("shows per-cut found-local-clean affordance when detect reports the cut id", async () => {
    const authFetch = makeRouteFetch([makeCut({ id: 1, cleanImagePath: null })], [1]);
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Test scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Test scene"));

    await waitFor(() => {
      expect(screen.getByTestId("found-local-clean-1")).toBeInTheDocument();
      expect(screen.getByText("Found local clean image — sync to cut plan")).toBeInTheDocument();
    });
  });

  it("does not show the found-local-clean affordance when detect returns empty", async () => {
    const authFetch = makeRouteFetch([makeCut({ id: 1, cleanImagePath: null })], []);
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Test scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Test scene"));

    // give detect a chance to resolve, then assert it is absent.
    await waitFor(() => expect(screen.getByTestId("copy-prompt-1")).toBeInTheDocument());
    expect(screen.queryByTestId("found-local-clean-1")).not.toBeInTheDocument();
  });

  it("clicking found-local-clean POSTs sync-clean-images and reloads cuts + detect", async () => {
    const authFetch = makeRouteFetch([makeCut({ id: 1, cleanImagePath: null })], [1]);
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);

    await waitFor(() => expect(screen.getByText("Test scene")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Test scene"));
    await waitFor(() => expect(screen.getByTestId("found-local-clean-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("found-local-clean-1"));

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith(
        "/api/stories/story/cuts/plot-01/sync-clean-images",
        { method: "POST" },
      );
    });
    await waitFor(() => {
      const urls = authFetch.mock.calls.map((c: [string]) => c[0]);
      // cuts reloaded and detect re-fetched after sync.
      expect(urls.filter((u: string) => u === "/api/stories/story/cuts/plot-01").length).toBeGreaterThanOrEqual(2);
      expect(urls.filter((u: string) => u.endsWith("/detect-clean-images")).length).toBeGreaterThanOrEqual(2);
    });
  });

  // #311: a clear "clean-asset generation complete" done-state so the operator
  // knows Codex is finished even if the terminal session is still connected.
  describe("clean-assets-ready done state (#311)", () => {
    it("shows the done banner when every cut has a present clean image", async () => {
      const cutsData = {
        version: 1, plotFile: "plot-01",
        cuts: [
          makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp" }),
          makeCut({ id: 2, cleanImagePath: "assets/plot-01/cut-02-clean.webp" }),
        ],
      };
      const authFetch = mockAuthFetch({ ok: true, data: cutsData });
      render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
      await waitFor(() => expect(screen.getByTestId("clean-assets-ready")).toBeInTheDocument());
      expect(screen.getByTestId("clean-assets-ready")).toHaveTextContent("All 2 clean images present");
    });

    it("does not show the done banner while a cut is still missing its clean image", async () => {
      const cutsData = {
        version: 1, plotFile: "plot-01",
        cuts: [
          makeCut({ id: 1, cleanImagePath: "assets/plot-01/cut-01-clean.webp" }),
          makeCut({ id: 2, description: "Still missing", cleanImagePath: null }),
        ],
      };
      const authFetch = mockAuthFetch({ ok: true, data: cutsData });
      render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
      await waitFor(() => expect(screen.getByText("Still missing")).toBeInTheDocument());
      expect(screen.queryByTestId("clean-assets-ready")).not.toBeInTheDocument();
    });

    it("does not show the done banner while detect-clean-images is still pending (#311 re1)", async () => {
      const cutsData = {
        version: 1, plotFile: "plot-01",
        cuts: [makeCut({ id: 1, description: "Pending verify", cleanImagePath: "assets/plot-01/cut-01-clean.webp" })],
      };
      const authFetch = vi.fn((url: string) => {
        if (url.includes("/detect-clean-images")) return new Promise(() => {}); // never resolves
        if (url.includes("/asset/")) return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"], { type: "image/webp" })) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });
      });
      render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
      await waitFor(() => expect(screen.getByText("Pending verify")).toBeInTheDocument());
      // Cut-plan fields say "clean" but detection has not confirmed disk state yet.
      expect(screen.queryByTestId("clean-assets-ready")).not.toBeInTheDocument();
    });

    it("does not show the done banner when detect-clean-images fails (#311 re1)", async () => {
      const cutsData = {
        version: 1, plotFile: "plot-01",
        cuts: [makeCut({ id: 1, description: "Detect failed", cleanImagePath: "assets/plot-01/cut-01-clean.webp" })],
      };
      const authFetch = vi.fn((url: string) => {
        if (url.includes("/detect-clean-images")) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) });
        if (url.includes("/asset/")) return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"], { type: "image/webp" })) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });
      });
      render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
      await waitFor(() => expect(screen.getByText("Detect failed")).toBeInTheDocument());
      // Detection failed → unverified → no false "complete" signal.
      expect(screen.queryByTestId("clean-assets-ready")).not.toBeInTheDocument();
    });

    it("does not show the done banner when a recorded clean path is stale/missing on disk", async () => {
      const cutsData = {
        version: 1, plotFile: "plot-01",
        cuts: [makeCut({ id: 1, description: "Has recorded path", cleanImagePath: "assets/plot-01/cut-01-clean.webp" })],
      };
      const authFetch = vi.fn((url: string) => {
        if (url.includes("/detect-clean-images")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ detected: [], stale: [{ cutId: 1, field: "cleanImagePath", path: "assets/plot-01/cut-01-clean.webp", message: "missing" }] }) });
        }
        if (url.includes("/asset/")) return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"], { type: "image/webp" })) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cutsData) });
      });
      render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
      await waitFor(() => expect(screen.getByText("Has recorded path")).toBeInTheDocument());
      // Stale recorded path surfaces as "Image missing" in the row header (#302).
      await waitFor(() => expect(screen.getByText("Image missing")).toBeInTheDocument());
      expect(screen.queryByTestId("clean-assets-ready")).not.toBeInTheDocument();
    });
  });
});

describe("CutListPanel stale bubble-renderer warning (#381)", () => {
  const tailedSpeech = { id: "ov1", type: "speech", x: 0.1, y: 0.1, width: 0.3, height: 0.15, text: "Hi", tailAnchor: { x: 0.5, y: 1.2 } };

  it("warns to re-export a tailed-bubble final image lettered by an older renderer", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "assets/plot-01/cut-01-final.webp", overlays: [tailedSpeech] })], // no version stamp → stale
    };
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={mockAuthFetch({ ok: true, data: cutsData })} />);
    const warn = await screen.findByTestId("stale-bubble-export-warning");
    expect(warn).toHaveTextContent(/Cut 1/);
    expect(warn).toHaveTextContent(/re-export/i);
  });

  it("does NOT warn when the final image was exported by the current renderer", async () => {
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "x.webp", overlays: [tailedSpeech], finalRendererVersion: CARTOON_BUBBLE_RENDERER_VERSION })],
    };
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={mockAuthFetch({ ok: true, data: cutsData })} />);
    await screen.findByTestId("cartoon-workflow-help");
    expect(screen.queryByTestId("stale-bubble-export-warning")).not.toBeInTheDocument();
  });

  it("does NOT warn for a tailless bubble even if unstamped", async () => {
    const noTail = { ...tailedSpeech, tailAnchor: { x: 0.5, y: 0.5 } }; // tip inside → no visible tail
    const cutsData = {
      version: 1, plotFile: "plot-01",
      cuts: [makeCut({ id: 1, finalImagePath: "x.webp", overlays: [noTail] })],
    };
    render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={mockAuthFetch({ ok: true, data: cutsData })} />);
    await screen.findByTestId("cartoon-workflow-help");
    expect(screen.queryByTestId("stale-bubble-export-warning")).not.toBeInTheDocument();
  });
});
