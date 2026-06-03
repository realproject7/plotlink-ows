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
