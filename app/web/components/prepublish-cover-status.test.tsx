import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

// #312: make the generated cartoon cover's connection to the publish flow
// explicit — whether assets/cover.webp will be uploaded as the PlotLink cover,
// is invalid, or is missing (with a clear action).
beforeAll(() => installObjectUrlStub());
afterEach(cleanup);

const WALLET = "test-wallet-address";
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const DRAFT_GENESIS = { file: "genesis.md", status: "draft", content: "# A story\n\nHook." };

/** authFetch double driving the /cover-asset detection result. */
function makeAuthFetch(coverAsset: Record<string, unknown> | null) {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url.endsWith("/cover-asset")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(coverAsset ?? { found: false }) });
    }
    if (url.includes("/asset/")) {
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob([WEBP], { type: "image/webp" })) });
    }
    if (url.includes("/api/stories/") && (!opts || (opts.method ?? "GET") === "GET")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DRAFT_GENESIS) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

// #461: the pre-publish cover picker now renders for FICTION genesis only. The
// detected/will-upload/import-warning status UI is content-type agnostic, so
// these tests run on a fiction genesis (the picker behavior is unchanged). The
// cartoon-only "no generated cover" guidance moved off the episode entirely.
function renderGenesis(authFetch: ReturnType<typeof makeAuthFetch>, contentType: "cartoon" | "fiction" = "fiction") {
  render(
    <PreviewPanel
      storyName="my-story"
      fileName="genesis.md"
      authFetch={authFetch}
      onPublish={vi.fn()}
      publishingFile={null}
      walletAddress={WALLET}
      contentType={contentType}
      onViewPublish={vi.fn()}
    />,
  );
  return contentType === "cartoon" ? screen.findByTestId("cartoon-review-publish") : screen.findByTestId("prepublish-cover");
}

describe("PreviewPanel cartoon cover status (#312)", () => {
  it("states a detected generated cover WILL be uploaded as the PlotLink cover", async () => {
    const authFetch = makeAuthFetch({ found: true, valid: true, path: "assets/cover.webp", type: "image/webp" });
    await renderGenesis(authFetch);
    expect(await screen.findByTestId("prepublish-cover-will-upload")).toHaveTextContent(
      "uploaded as the PlotLink storyline cover",
    );
    expect(await screen.findByTestId("prepublish-cover-detected")).toHaveTextContent("assets/cover.webp");
  });

  it("points an invalid generated cover to the import action (manual confirmation path)", async () => {
    const authFetch = makeAuthFetch({ found: true, valid: false, path: "assets/cover.webp", type: "image/webp", error: "assets/cover.webp is 1200KB, exceeds the 1MB cover limit" });
    await renderGenesis(authFetch);
    const warn = await screen.findByTestId("prepublish-cover-detected-warning");
    expect(warn).toHaveTextContent("exceeds the 1MB");
    expect(warn).toHaveTextContent("Import generated image");
    // Invalid cover is not silently used.
    expect(screen.queryByTestId("prepublish-cover-will-upload")).not.toBeInTheDocument();
  });

  it("clears an invalid generated-cover warning after a valid manual pick", async () => {
    const authFetch = makeAuthFetch({ found: true, valid: false, path: "assets/cover.webp", type: "image/webp", error: "assets/cover.webp is 1200KB, exceeds the 1MB cover limit" });
    await renderGenesis(authFetch);
    expect(await screen.findByTestId("prepublish-cover-detected-warning")).toHaveTextContent("exceeds the 1MB");

    const input = screen.getByTestId("prepublish-cover-input") as HTMLInputElement;
    const cover = new File([WEBP], "manual-cover.webp", { type: "image/webp" });
    fireEvent.change(input, { target: { files: [cover] } });

    await waitFor(() => expect(screen.queryByTestId("prepublish-cover-detected-warning")).not.toBeInTheDocument());
    expect(await screen.findByTestId("prepublish-cover-will-upload")).toHaveTextContent(
      "uploaded as the PlotLink storyline cover",
    );
    expect(screen.queryByTestId("prepublish-cover-detected")).not.toBeInTheDocument();
  });

  // #461: the cartoon genesis episode no longer hosts the cover picker, so the
  // cartoon-only "no generated cover" guidance is gone from the episode — the
  // cover is managed on Story Info and auto-loaded on the Publish tab.
  it("does not render the cover picker (or no-cover guidance) in the cartoon genesis episode", async () => {
    const authFetch = makeAuthFetch(null);
    await renderGenesis(authFetch, "cartoon");
    expect(screen.queryByTestId("prepublish-cover")).not.toBeInTheDocument();
    expect(screen.queryByTestId("prepublish-cover-none")).not.toBeInTheDocument();
  });

  it("does NOT show the cartoon no-cover guidance for a fiction genesis", async () => {
    const authFetch = makeAuthFetch(null);
    await renderGenesis(authFetch, "fiction");
    // Give the detection effect a chance to run, then assert the cartoon-only
    // guidance never appears for fiction.
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("/cover-asset")));
    expect(screen.queryByTestId("prepublish-cover-none")).not.toBeInTheDocument();
  });
});
