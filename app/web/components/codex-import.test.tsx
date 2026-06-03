import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { installObjectUrlStub } from "./asset-test-utils";

// #403: import a Codex-generated cache PNG straight into a cut, no OS file dialog.
// The real PNG->WebP converter needs canvas/createImageBitmap (absent in jsdom),
// so mock the converter module and assert the wiring: opening the picker lists the
// cache, picking an image fetches its bytes and uploads a converted WebP to the
// existing upload-clean route.
const mockConvert = vi.fn();
vi.mock("../lib/import-image", () => ({
  isCompliantImage: (f: { type: string; size: number }) =>
    ["image/webp", "image/jpeg"].includes(f.type) && f.size <= 1024 * 1024,
  importImageToCompliantBlob: (f: File) => mockConvert(f),
}));

import { CutListPanel } from "./CutListPanel";
import { CodexImportPicker, formatRelativeTime } from "./CodexImportPicker";
import { listCodexCacheImages, fetchCodexCacheFile } from "../lib/codex-import";

beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  mockConvert.mockReset();
});

afterEach(cleanup);

function jsonRes(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) } as unknown as Response;
}
function blobRes(blob: Blob) {
  return {
    ok: true,
    status: 200,
    blob: () => Promise.resolve(blob),
    headers: { get: () => blob.type },
  } as unknown as Response;
}

function makeCut(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, shotType: "medium", description: "Codex cut",
    characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null,
    exportedAt: null, uploadedCid: null, uploadedUrl: null, overlays: [],
    ...overrides,
  };
}

/** authFetch router so call ordering (thumbnail vs import vs reload) doesn't matter. */
function makeAuthFetch(images: unknown[]) {
  const cutsData = { version: 1, plotFile: "plot-01", cuts: [makeCut()] };
  return vi.fn((url: string, opts?: RequestInit) => {
    const method = opts?.method || "GET";
    if (url.includes("/detect-clean-images")) return Promise.resolve(jsonRes({ detected: [], stale: [] }));
    if (url.endsWith("/cuts/plot-01") && method === "GET") return Promise.resolve(jsonRes(cutsData));
    if (url === "/api/codex/images") return Promise.resolve(jsonRes({ images }));
    if (url.startsWith("/api/codex/images/")) {
      return Promise.resolve(blobRes(new Blob([new Uint8Array(2_300_000)], { type: "image/png" })));
    }
    if (url.includes("/upload-clean/")) {
      return Promise.resolve(jsonRes({ ok: true, cleanImagePath: "assets/plot-01/cut-01-clean.webp" }));
    }
    return Promise.resolve(jsonRes({}));
  });
}

async function expandAndOpenPicker(authFetch: ReturnType<typeof vi.fn>) {
  render(<CutListPanel storyName="story" fileName="plot-01.md" authFetch={authFetch} />);
  await waitFor(() => expect(screen.getByText("Codex cut")).toBeInTheDocument());
  fireEvent.click(screen.getByText("Codex cut"));
  await waitFor(() => expect(screen.getByTestId("import-codex-1")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("import-codex-1"));
}

describe("Codex cache import picker (#403)", () => {
  it("lists cache images and imports a picked PNG as a converted WebP", async () => {
    mockConvert.mockResolvedValue(new Blob([new Uint8Array(2000)], { type: "image/webp" }));
    const authFetch = makeAuthFetch([{ token: "tok1", name: "ig_one.png", size: 2_300_000, mtimeMs: 3 }]);

    await expandAndOpenPicker(authFetch);
    await waitFor(() => expect(screen.getByTestId("codex-import-tok1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("codex-import-tok1"));

    await waitFor(() => {
      expect(mockConvert).toHaveBeenCalledTimes(1);
      expect(authFetch.mock.calls.some((c) => String(c[0]).includes("/upload-clean/1"))).toBe(true);
    });
    const uploadCall = authFetch.mock.calls.find((c) => String(c[0]).includes("/upload-clean/"))!;
    const body = (uploadCall[1] as RequestInit).body as FormData;
    expect((body.get("file") as File).type).toBe("image/webp");
    // The converter received the cache PNG (fetched from /api/codex/images/:token).
    expect((mockConvert.mock.calls[0][0] as File).type).toBe("image/png");
  });

  it("shows an empty state when the Codex cache has no images", async () => {
    const authFetch = makeAuthFetch([]);
    await expandAndOpenPicker(authFetch);
    await waitFor(() => expect(screen.getByTestId("codex-picker-empty-1")).toBeInTheDocument());
    expect(authFetch.mock.calls.some((c) => String(c[0]).includes("/upload-clean/"))).toBe(false);
  });
});

describe("Codex picker visual selection + filtering (#409)", () => {
  function pickerAuthFetch(images: unknown[]) {
    return vi.fn((url: string) => {
      if (url === "/api/codex/images") return Promise.resolve(jsonRes({ images }));
      if (url.startsWith("/api/codex/images/")) {
        return Promise.resolve(blobRes(new Blob([new Uint8Array(10)], { type: "image/png" })));
      }
      return Promise.resolve(jsonRes({}));
    });
  }

  function renderPicker(images: unknown[]) {
    const authFetch = pickerAuthFetch(images);
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(
      <CodexImportPicker authFetch={authFetch} cutId={1} onImport={onImport} onClose={vi.fn()} />,
    );
    return { authFetch, onImport };
  }

  it("formatRelativeTime gives readable, now-relative labels (and never a negative future)", () => {
    const now = 10_000_000_000;
    expect(formatRelativeTime(now - 10_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe("2h ago");
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe("3d ago");
    expect(formatRelativeTime(now - 2 * 7 * 86_400_000, now)).toBe("2w ago");
    // Clock skew (mtime in the future) degrades gracefully, never "-1m ago".
    expect(formatRelativeTime(now + 60_000, now)).toBe("just now");
  });

  it("shows readable time + size metadata and demotes the noisy hash filename to a hover title", async () => {
    renderPicker([
      { token: "tA", name: "ig_alpha.png", size: 2_300_000, mtimeMs: Date.now() - 5 * 60_000 },
    ]);
    await waitFor(() => expect(screen.getByTestId("codex-image-tA")).toBeInTheDocument());
    const row = screen.getByTestId("codex-image-tA");
    // Readable metadata leads; the size is shown alongside the "x ago" cue.
    expect(row.textContent).toMatch(/ago/);
    expect(row.textContent).toMatch(/2\.2 MB/);
    // The hash filename is still available, but as a hover title (reduced noise).
    expect(screen.getByTitle("ig_alpha.png")).toBeInTheDocument();
  });

  it("filters the list by file name and reports the visible count", async () => {
    renderPicker([
      { token: "tA", name: "ig_alpha.png", size: 100, mtimeMs: 3 },
      { token: "tB", name: "ig_beta.png", size: 100, mtimeMs: 2 },
      { token: "tC", name: "ig_gamma.png", size: 100, mtimeMs: 1 },
    ]);
    await waitFor(() => expect(screen.getByTestId("codex-image-tA")).toBeInTheDocument());
    expect(screen.getByTestId("codex-picker-count-1").textContent).toBe("3 images");

    fireEvent.change(screen.getByTestId("codex-picker-search-1"), { target: { value: "beta" } });

    await waitFor(() => expect(screen.queryByTestId("codex-image-tA")).not.toBeInTheDocument());
    expect(screen.getByTestId("codex-image-tB")).toBeInTheDocument();
    expect(screen.queryByTestId("codex-image-tC")).not.toBeInTheDocument();
    expect(screen.getByTestId("codex-picker-count-1").textContent).toBe("1 of 3");
  });

  it("shows a no-match state (still read-only) when the filter excludes everything", async () => {
    const { onImport } = renderPicker([
      { token: "tA", name: "ig_alpha.png", size: 100, mtimeMs: 1 },
    ]);
    await waitFor(() => expect(screen.getByTestId("codex-image-tA")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("codex-picker-search-1"), { target: { value: "zzz-nope" } });

    await waitFor(() => expect(screen.getByTestId("codex-picker-no-match-1")).toBeInTheDocument());
    expect(screen.queryByTestId("codex-image-tA")).not.toBeInTheDocument();
    // Filtering imports nothing — read-only until an explicit Import click.
    expect(onImport).not.toHaveBeenCalled();
  });

  it("empty-state copy points at Codex without the old terminal jargon", async () => {
    renderPicker([]);
    await waitFor(() => expect(screen.getByTestId("codex-picker-empty-1")).toBeInTheDocument());
    const empty = screen.getByTestId("codex-picker-empty-1");
    expect(empty.textContent).toMatch(/Generate art in Codex/);
    expect(empty.textContent).not.toMatch(/terminal/i);
    // No filter box when there are no images to filter.
    expect(screen.queryByTestId("codex-picker-search-1")).not.toBeInTheDocument();
  });
});

describe("codex-import client lib (#403)", () => {
  it("returns [] from listCodexCacheImages on a non-OK response and filters malformed entries", async () => {
    const bad = vi.fn(() => Promise.resolve({ ok: false, status: 500 } as unknown as Response));
    expect(await listCodexCacheImages(bad)).toEqual([]);

    const mixed = vi.fn(() =>
      Promise.resolve(jsonRes({
        images: [
          { token: "ok", name: "a.png", size: 1, mtimeMs: 1 },
          { token: "", name: "empty-token", size: 1, mtimeMs: 1 },
          { name: "no-token", size: 1, mtimeMs: 1 },
          "garbage",
        ],
      })),
    );
    const out = await listCodexCacheImages(mixed);
    expect(out.map((i) => i.token)).toEqual(["ok"]);
  });

  it("throws a clear error from fetchCodexCacheFile when the image cannot be read", async () => {
    const fail = vi.fn(() => Promise.resolve({ ok: false, status: 404 } as unknown as Response));
    await expect(
      fetchCodexCacheFile(fail, { token: "t", name: "x.png", size: 1, mtimeMs: 1 }),
    ).rejects.toThrow(/Codex cache/);
  });
});
