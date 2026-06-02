import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

// #337: a cartoon writer must always see cover readiness (none / selected /
// invalid / attached) + the cover requirements before publishing, so a pilot
// story is never published coverless or with a bad cover.
beforeAll(() => installObjectUrlStub());
afterEach(cleanup);

const WALLET = "test-wallet-address";
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
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
  it("shows a 'no cover yet' status and the cover requirements for a cartoon genesis", async () => {
    await renderGenesis(makeAuthFetch());
    const status = await screen.findByTestId("cartoon-cover-status");
    expect(status).toHaveAttribute("data-state", "none");
    expect(status).toHaveTextContent(/no cover yet/i);
    const guidance = screen.getByTestId("cartoon-cover-guidance");
    expect(guidance).toHaveTextContent(/WebP/);
    expect(guidance).toHaveTextContent(/1MB/);
    expect(guidance).toHaveTextContent(/600.?900/);
    expect(guidance).toHaveTextContent(/AI text|unreadable/i);
  });

  it("advances to 'selected' after a valid cover is picked", async () => {
    await renderGenesis(makeAuthFetch());
    const input = screen.getByTestId("prepublish-cover-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([WEBP], "cover.webp", { type: "image/webp" })] } });
    await waitFor(() =>
      expect(screen.getByTestId("cartoon-cover-status")).toHaveAttribute("data-state", "selected"),
    );
  });

  it("shows an 'invalid' status when a non-WebP/JPEG (or oversized) cover is picked", async () => {
    await renderGenesis(makeAuthFetch());
    const input = screen.getByTestId("prepublish-cover-input") as HTMLInputElement;
    // PNG is not an allowed cover type → rejected before publish.
    fireEvent.change(input, { target: { files: [new File([WEBP], "cover.png", { type: "image/png" })] } });
    await waitFor(() =>
      expect(screen.getByTestId("cartoon-cover-status")).toHaveAttribute("data-state", "invalid"),
    );
    // The inline validation error is shown too (before any publish attempt).
    expect(screen.getByTestId("prepublish-cover-error")).toBeInTheDocument();
  });

  it("does not show cartoon cover status for a fiction genesis", async () => {
    const authFetch = makeAuthFetch();
    await renderGenesis(authFetch, "fiction");
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("/cover-asset")));
    expect(screen.queryByTestId("cartoon-cover-status")).not.toBeInTheDocument();
  });

  // #337 (re1): attaching a cover via the published Edit Story flow must flip the
  // status badge to "attached" in the same panel, without closing/reopening it.
  it("published cartoon: attaching a cover via Edit Story flips the status to attached", async () => {
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

      // Open Edit Story (published cartoon genesis owned by this wallet).
      const editBtn = await screen.findByText("Edit Story");
      fireEvent.click(editBtn);

      // Status starts as "no cover" (metadata returned no coverCid).
      await waitFor(() => expect(screen.getByTestId("cartoon-cover-status")).toHaveAttribute("data-state", "none"));

      // Pick a valid cover and save through the existing edit flow.
      const input = screen.getByTestId("cover-input") as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File([WEBP], "cover.webp", { type: "image/webp" })] } });
      await waitFor(() => expect(screen.getByText("Save Changes")).toBeEnabled());
      fireEvent.click(screen.getByText("Save Changes"));

      // After a successful attach, the badge reads "attached" in the same panel.
      await waitFor(() => expect(screen.getByTestId("cartoon-cover-status")).toHaveAttribute("data-state", "attached"));
      expect(authFetch).toHaveBeenCalledWith("/api/publish/upload-cover", expect.objectContaining({ method: "POST" }));
    } finally {
      global.fetch = origFetch;
    }
  });
});
