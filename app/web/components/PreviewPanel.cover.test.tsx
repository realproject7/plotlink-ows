import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

beforeAll(() => {
  installObjectUrlStub();
});

afterEach(cleanup);

const STORYLINE_ID = 42;
const WALLET = "0x1111111111111111111111111111111111111111";

// Genesis FileData the component loads on mount — published genesis owned by the
// wallet, so the "Edit Story" panel (with the cover input) is available.
const GENESIS_FILE = {
  file: "genesis.md",
  status: "published",
  content: "# A story\n\nHook.",
  storylineId: STORYLINE_ID,
};

function fileOf(type: string, name: string): File {
  return new File(["x"], name, { type });
}

/**
 * authFetch double that records calls and answers the routes PreviewPanel hits:
 * GET the genesis file, POST upload-cover, POST update-storyline. Everything
 * else resolves to an empty ok JSON so unrelated effects don't throw.
 */
function makeAuthFetch() {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fn = vi.fn((url: string, opts?: RequestInit) => {
    calls.push({ url, method: opts?.method ?? "GET", body: opts?.body });
    if (url.includes("/api/stories/") && (!opts || (opts.method ?? "GET") === "GET")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(GENESIS_FILE) });
    }
    if (url.includes("/api/publish/upload-cover")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cid: "QmStaleCover" }) });
    }
    if (url.includes("/api/publish/update-storyline")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
  return { fn, calls };
}

describe("PreviewPanel cover selection", () => {
  beforeEach(() => {
    // The edit panel loads current storyline metadata via a global fetch; stub
    // it so editMetaLoaded becomes true and the Save button enables.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ genre: "Fantasy", language: "English", isNsfw: false }),
        }),
      ) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function openEditPanel(authFetch: ReturnType<typeof makeAuthFetch>["fn"]) {
    render(
      <PreviewPanel
        storyName="my-story"
        fileName="genesis.md"
        authFetch={authFetch}
        onPublish={vi.fn()}
        publishingFile={null}
        walletAddress={WALLET}
      />,
    );
    const editBtn = await screen.findByRole("button", { name: "Edit Story" });
    fireEvent.click(editBtn);
    // Wait until storyline metadata loads (Save button leaves the "Loading..." state).
    await screen.findByRole("button", { name: "Save Changes" });
  }

  it("selecting an invalid cover after a valid one clears the stale cover so Save does not upload it", async () => {
    const { fn: authFetch, calls } = makeAuthFetch();
    await openEditPanel(authFetch);

    const input = screen.getByTestId("cover-input") as HTMLInputElement;

    // 1) Select a valid WebP cover → queued + preview shown.
    fireEvent.change(input, { target: { files: [fileOf("image/webp", "cover.webp")] } });
    expect(await screen.findByAltText("Cover preview")).toBeInTheDocument();

    // 2) Select an invalid PNG → clear error, and the stale valid cover is dropped.
    fireEvent.change(input, { target: { files: [fileOf("image/png", "bad.png")] } });
    expect(await screen.findByText("Only WebP and JPEG images are accepted")).toBeInTheDocument();
    expect(screen.queryByAltText("Cover preview")).not.toBeInTheDocument();

    // 3) Save → must NOT upload the stale cover, and update-storyline carries no coverCid.
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("/api/publish/update-storyline"))).toBe(true);
    });
    expect(calls.some((c) => c.url.includes("/api/publish/upload-cover"))).toBe(false);

    const update = calls.find((c) => c.url.includes("/api/publish/update-storyline"))!;
    const body = JSON.parse(update.body as string);
    expect(body.coverCid).toBeUndefined();
    expect(body.storylineId).toBe(STORYLINE_ID);
  });

  it("a valid cover selection is uploaded on Save (positive control)", async () => {
    const { fn: authFetch, calls } = makeAuthFetch();
    await openEditPanel(authFetch);

    const input = screen.getByTestId("cover-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOf("image/webp", "cover.webp")] } });
    expect(await screen.findByAltText("Cover preview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("/api/publish/upload-cover"))).toBe(true);
    });
    const update = calls.find((c) => c.url.includes("/api/publish/update-storyline"))!;
    expect(JSON.parse(update.body as string).coverCid).toBe("QmStaleCover");
  });
});
