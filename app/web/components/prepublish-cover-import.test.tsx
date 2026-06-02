import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { installObjectUrlStub } from "./asset-test-utils";

// #301: the genesis pre-publish cover section lets a writer import a
// Codex-generated image (e.g. PNG). The browser converter
// (importImageToCompliantBlob) is mocked here (jsdom has no canvas); the test
// asserts the wiring — a successful import POSTs to import-cover and loads the
// cover for publish, while a conversion failure surfaces an error and saves
// nothing.
const mockConvert = vi.fn();
vi.mock("../lib/import-image", () => ({
  importImageToCompliantBlob: (f: File) => mockConvert(f),
}));

import { PreviewPanel } from "./PreviewPanel";

beforeAll(() => {
  installObjectUrlStub();
});

afterEach(() => {
  cleanup();
  mockConvert.mockReset();
});

const WALLET = "test-wallet-address";
const DRAFT_GENESIS = { file: "genesis.md", status: "draft", content: "# A story\n\nHook." };

/** authFetch double: genesis content + no auto-detected cover + import-cover OK. */
function makeAuthFetch(importCoverOk = true) {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url.endsWith("/cover-asset")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ found: false }) });
    }
    if (url.endsWith("/import-cover")) {
      return Promise.resolve({
        ok: importCoverOk,
        status: importCoverOk ? 200 : 400,
        json: () => Promise.resolve(importCoverOk ? { ok: true, path: "assets/cover.webp" } : { error: "import failed" }),
      });
    }
    if (url.includes("/api/stories/") && (!opts || (opts.method ?? "GET") === "GET")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DRAFT_GENESIS) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

async function renderDraft(authFetch: ReturnType<typeof makeAuthFetch>) {
  render(
    <PreviewPanel
      storyName="my-story"
      fileName="genesis.md"
      authFetch={authFetch}
      onPublish={vi.fn()}
      publishingFile={null}
      walletAddress={WALLET}
      contentType="cartoon"
    />,
  );
  await screen.findByTestId("prepublish-cover");
}

describe("PreviewPanel cover import (#301)", () => {
  it("converts a PNG, saves it via import-cover, and loads it as the cover", async () => {
    mockConvert.mockResolvedValue(new Blob([new Uint8Array(3000)], { type: "image/webp" }));
    const authFetch = makeAuthFetch(true);
    await renderDraft(authFetch);

    const input = screen.getByTestId("prepublish-cover-import-input") as HTMLInputElement;
    const png = new File([new Uint8Array(2 * 1024 * 1024)], "gen.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [png] } });

    await waitFor(() => {
      expect(mockConvert).toHaveBeenCalledTimes(1);
      expect(authFetch).toHaveBeenCalledWith(
        "/api/stories/my-story/import-cover",
        expect.objectContaining({ method: "POST" }),
      );
    });
    // The converted cover is loaded into the cover selection.
    expect(await screen.findByAltText("Cover preview")).toBeInTheDocument();
    // The imported file POSTed is a WebP.
    const importCall = authFetch.mock.calls.find((c) => String(c[0]).endsWith("/import-cover"))!;
    const body = importCall[1].body as FormData;
    expect((body.get("file") as File).type).toBe("image/webp");
  });

  it("surfaces a clear error and saves nothing when conversion fails", async () => {
    mockConvert.mockRejectedValue(new Error("Cannot compress image under 1MB — reduce overlay count or image size"));
    const authFetch = makeAuthFetch(true);
    await renderDraft(authFetch);

    const input = screen.getByTestId("prepublish-cover-import-input") as HTMLInputElement;
    const png = new File([new Uint8Array(9 * 1024 * 1024)], "huge.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [png] } });

    expect(await screen.findByTestId("prepublish-cover-error")).toHaveTextContent(/under 1MB/);
    // Conversion failed → import-cover never called, no cover preview.
    expect(authFetch.mock.calls.some((c) => String(c[0]).endsWith("/import-cover"))).toBe(false);
    expect(screen.queryByAltText("Cover preview")).not.toBeInTheDocument();
  });
});
