import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { AssetImage, assetUrl } from "./asset-image";
import { installObjectUrlStub, MOCK_BLOB_URL } from "./asset-test-utils";

beforeAll(() => {
  installObjectUrlStub();
});

afterEach(cleanup);

function blobFetch() {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/webp" })),
    } as unknown as Response),
  );
}

describe("assetUrl", () => {
  it("maps a story-relative path to the auth-protected API route", () => {
    expect(assetUrl("my-story", "assets/plot-01/cut-01-clean.webp")).toBe(
      "/api/stories/my-story/asset/plot-01/cut-01-clean.webp",
    );
  });

  it("tolerates a path that is not prefixed with assets/", () => {
    expect(assetUrl("my-story", "plot-01/cut-01-clean.webp")).toBe(
      "/api/stories/my-story/asset/plot-01/cut-01-clean.webp",
    );
  });
});

describe("AssetImage (auth-header / raw-img regression)", () => {
  it("loads the asset through authFetch and renders the blob object URL, never the raw protected URL", async () => {
    // The whole bug: a browser <img src="/api/stories/.../asset/..."> cannot
    // attach the Bearer header, so the protected route 401s. AssetImage must
    // fetch with authFetch (which adds the header) and render the object URL.
    const authFetch = blobFetch();
    render(
      <AssetImage
        storyName="my-story"
        assetPath="assets/plot-01/cut-01-clean.webp"
        authFetch={authFetch}
        alt="clean cut"
      />,
    );

    const img = await screen.findByAltText("clean cut");
    expect(img).toHaveAttribute("src", MOCK_BLOB_URL);
    expect(img.getAttribute("src")).not.toContain("/api/stories/");
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledWith("/api/stories/my-story/asset/plot-01/cut-01-clean.webp");
  });

  it("shows an unavailable state when the authenticated request fails (e.g. 401)", async () => {
    const authFetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 401, blob: () => Promise.resolve(new Blob()) } as unknown as Response),
    );
    render(
      <AssetImage
        storyName="my-story"
        assetPath="assets/plot-01/cut-01-clean.webp"
        authFetch={authFetch}
        alt="clean cut"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Image not available")).toBeInTheDocument();
    });
    expect(screen.queryByAltText("clean cut")).not.toBeInTheDocument();
  });

  it("revokes the object URL on unmount so blobs do not leak across cut selections", async () => {
    const authFetch = blobFetch();
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    const { unmount } = render(
      <AssetImage
        storyName="my-story"
        assetPath="assets/plot-01/cut-01-clean.webp"
        authFetch={authFetch}
        alt="clean cut"
      />,
    );

    await screen.findByAltText("clean cut");
    unmount();
    expect(revokeSpy).toHaveBeenCalledWith(MOCK_BLOB_URL);
  });
});
