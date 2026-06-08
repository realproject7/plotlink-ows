import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

// #337: a cartoon writer must always see cover readiness (none / selected /
// invalid / attached) + the cover requirements before publishing, so a pilot
// story is never published coverless or with a bad cover.
beforeAll(() => installObjectUrlStub());
afterEach(cleanup);

const WALLET = "test-wallet-address";
const DRAFT_GENESIS = { file: "genesis.md", status: "draft", content: "# A story\n\nHook." };

// authFetch double: no generated cover detected, plain genesis otherwise.
function makeAuthFetch() {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url.endsWith("/cover-asset")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ found: false }) });
    }
    if (url.includes("/api/stories/") && (!opts || (opts.method ?? "GET") === "GET")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DRAFT_GENESIS) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

function renderGenesis(authFetch: ReturnType<typeof makeAuthFetch>, contentType: "cartoon" | "fiction" = "cartoon") {
  render(
    <PreviewPanel
      storyName="my-story"
      fileName="genesis.md"
      authFetch={authFetch}
      onPublish={vi.fn()}
      publishingFile={null}
      walletAddress={WALLET}
      contentType={contentType}
    />,
  );
  return screen.findByTestId("prepublish-cover");
}

describe("cartoon cover readiness (#337)", () => {
  // #461: the cartoon episode (Genesis) view no longer hosts the pre-publish
  // cover picker — the cover is managed on Story Info (see StoryInfoPage.test)
  // and auto-loaded at publish on the Publish tab (see CartoonPublishPage). So a
  // cartoon Genesis renders NO pre-publish cover picker or cover-status badge.
  it("does not render the pre-publish cover picker in the cartoon genesis episode (#461)", async () => {
    const authFetch = makeAuthFetch();
    render(
      <PreviewPanel
        storyName="my-story"
        fileName="genesis.md"
        authFetch={authFetch}
        onPublish={vi.fn()}
        publishingFile={null}
        walletAddress={WALLET}
        contentType="cartoon"
        onViewPublish={vi.fn()}
      />,
    );
    await screen.findByText("No cuts yet");
    expect(screen.queryByTestId("prepublish-cover")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cartoon-cover-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cartoon-review-publish")).not.toBeInTheDocument();
  });

  it("does not show cartoon cover status for a fiction genesis", async () => {
    const authFetch = makeAuthFetch();
    await renderGenesis(authFetch, "fiction");
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("/cover-asset")));
    expect(screen.queryByTestId("cartoon-cover-status")).not.toBeInTheDocument();
  });

  // #337 moved to Story Info: a published cartoon episode no longer exposes the
  // Edit Story cover surface inside PreviewPanel.
  it("published cartoon: does not expose the old Edit Story cover surface in the episode", async () => {
    const PUBLISHED_GENESIS = { file: "genesis.md", status: "published", storylineId: 5, content: "# A story\n\nHook." };
    const authFetch = vi.fn((url: string) => {
      if (url === "/api/publish/upload-cover") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cid: "QmCover" }) });
      }
      if (url === "/api/publish/update-storyline") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      }
      // story file load + structure.md genre detect, etc.
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PUBLISHED_GENESIS) });
    });
    // Published metadata fetch hits plotlink.xyz via global fetch; no cover yet.
    const origFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ genre: "Romance", language: "English", isNsfw: false }) })) as unknown as typeof fetch;
    try {
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

      await screen.findByText("No cuts yet");
      expect(screen.queryByText("Edit Story")).not.toBeInTheDocument();
      expect(screen.queryByTestId("cartoon-cover-status")).not.toBeInTheDocument();
      expect(screen.queryByTestId("cover-input")).not.toBeInTheDocument();
      expect(authFetch).not.toHaveBeenCalledWith(
        "/api/publish/upload-cover",
        expect.anything(),
      );
    } finally {
      global.fetch = origFetch;
    }
  });
});
