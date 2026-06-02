import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

beforeAll(() => {
  installObjectUrlStub();
});

afterEach(cleanup);

const WALLET = "0x1111111111111111111111111111111111111111";

// Unpublished (draft) genesis — the pre-publish cover section is shown.
const DRAFT_GENESIS = { file: "genesis.md", status: "draft", content: "# A story\n\nHook." };

const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

/**
 * authFetch double for the #296 auto-detect path: genesis content + a cover-asset
 * detection result + the asset bytes. `coverAsset` controls what /cover-asset
 * returns; null → no cover candidate.
 */
function makeAuthFetch(coverAsset: Record<string, unknown> | null) {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url.endsWith("/cover-asset")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(coverAsset ?? { found: false }) });
    }
    if (url.includes("/asset/")) {
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob([WEBP_BYTES], { type: "image/webp" })) });
    }
    if (url.includes("/api/stories/") && (!opts || (opts.method ?? "GET") === "GET")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DRAFT_GENESIS) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

function fileOf(type: string, name: string): File {
  return new File(["x"], name, { type });
}

async function renderDraft(authFetch: ReturnType<typeof makeAuthFetch>, onPublish = vi.fn()) {
  render(
    <PreviewPanel
      storyName="my-story"
      fileName="genesis.md"
      authFetch={authFetch}
      onPublish={onPublish}
      publishingFile={null}
      walletAddress={WALLET}
      contentType="cartoon"
    />,
  );
  await screen.findByTestId("prepublish-cover");
  return { onPublish, publishBtn: screen.getByRole("button", { name: "Publish to PlotLink" }) };
}

describe("PreviewPanel auto-detected cover (#296)", () => {
  it("detects a valid assets/cover.webp, shows status + preview, and publishes it without manual selection", async () => {
    const authFetch = makeAuthFetch({ found: true, valid: true, path: "assets/cover.webp", type: "image/webp" });
    const { onPublish, publishBtn } = await renderDraft(authFetch);

    // Status label + auto-loaded preview appear (no manual file pick).
    expect(await screen.findByTestId("prepublish-cover-detected")).toHaveTextContent("assets/cover.webp");
    expect(await screen.findByAltText("Cover preview")).toBeInTheDocument();

    fireEvent.click(publishBtn);

    expect(onPublish).toHaveBeenCalledTimes(1);
    const args = onPublish.mock.calls[0];
    expect(args[5]).toBeInstanceOf(File);
    expect((args[5] as File).name).toBe("cover.webp");
  });

  it("surfaces an invalid/oversize detected cover as a warning and does NOT use it", async () => {
    const authFetch = makeAuthFetch({ found: true, valid: false, path: "assets/cover.webp", type: "image/webp", error: "assets/cover.webp is 1200KB, exceeds the 1MB cover limit" });
    const { onPublish, publishBtn } = await renderDraft(authFetch);

    expect(await screen.findByTestId("prepublish-cover-detected-warning")).toHaveTextContent("exceeds the 1MB");
    // No auto-loaded cover preview.
    expect(screen.queryByAltText("Cover preview")).not.toBeInTheDocument();

    fireEvent.click(publishBtn);
    expect(onPublish).toHaveBeenCalledTimes(1);
    // Invalid detected cover → unchanged 5-arg publish (no cover attached).
    expect(onPublish.mock.calls[0][5]).toBeUndefined();
  });

  it("does nothing when no cover asset exists (unchanged 5-arg publish)", async () => {
    const authFetch = makeAuthFetch(null);
    const { onPublish, publishBtn } = await renderDraft(authFetch);
    expect(screen.queryByTestId("prepublish-cover-detected")).not.toBeInTheDocument();
    fireEvent.click(publishBtn);
    expect(onPublish.mock.calls[0][5]).toBeUndefined();
  });

  it("a manual pick overrides the auto-detected cover", async () => {
    const authFetch = makeAuthFetch({ found: true, valid: true, path: "assets/cover.webp", type: "image/webp" });
    const { onPublish, publishBtn } = await renderDraft(authFetch);

    // Wait for auto-detect to land, then override with a manual file.
    await screen.findByTestId("prepublish-cover-detected");
    const input = screen.getByTestId("prepublish-cover-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOf("image/webp", "manual.webp")] } });
    // The detected status clears once the writer picks their own file.
    await waitFor(() => expect(screen.queryByTestId("prepublish-cover-detected")).not.toBeInTheDocument());

    fireEvent.click(publishBtn);
    const args = onPublish.mock.calls[0];
    expect(args[5]).toBeInstanceOf(File);
    expect((args[5] as File).name).toBe("manual.webp");
  });
});
