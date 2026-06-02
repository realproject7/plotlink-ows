import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { installObjectUrlStub } from "./asset-test-utils";

// #375: a publish blocked before the stream (e.g. insufficient-balance preflight)
// must KEEP the writer's selected genesis cover. PreviewPanel drops the cover
// only when onPublish resolves truthy (publish actually attempted); a falsy/void
// result (blocked) leaves the cover selection intact for the retry.
//
// jsdom has no canvas, so the browser cover converter is mocked (as in
// prepublish-cover-import.test.tsx) purely to load a cover into the selection.
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
// Draft cartoon genesis with a real H1 (so it is not title-/genesis-blocked) and
// thus a live "Publish to PlotLink" button.
const DRAFT_GENESIS = { file: "genesis.md", status: "draft", content: "# A Story\n\nHook." };

function makeAuthFetch() {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url.endsWith("/cover-asset")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ found: false }) });
    }
    if (url.endsWith("/import-cover")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, path: "assets/cover.webp" }) });
    }
    if (url.includes("/api/stories/") && (!opts || (opts.method ?? "GET") === "GET")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DRAFT_GENESIS) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

async function renderWithSelectedCover(onPublish: (...args: unknown[]) => unknown) {
  const authFetch = makeAuthFetch();
  render(
    <PreviewPanel
      storyName="my-story"
      fileName="genesis.md"
      authFetch={authFetch as never}
      onPublish={onPublish as never}
      publishingFile={null}
      walletAddress={WALLET}
      contentType="cartoon"
    />,
  );
  await screen.findByTestId("prepublish-cover");
  // Import a cover so a coverFile is selected and gets passed to onPublish.
  mockConvert.mockResolvedValue(new Blob([new Uint8Array(3000)], { type: "image/webp" }));
  const input = screen.getByTestId("prepublish-cover-import-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(3000)], "cover.png", { type: "image/png" })] } });
  await screen.findByAltText("Cover preview");
  return { authFetch };
}

describe("PreviewPanel keeps the selected cover when publish is blocked (#375)", () => {
  it("retains the cover preview when onPublish resolves falsy (blocked preflight)", async () => {
    const onPublish = vi.fn().mockResolvedValue(false); // simulates a blocked preflight
    await renderWithSelectedCover(onPublish);

    fireEvent.click(await screen.findByRole("button", { name: "Publish to PlotLink" }));

    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
    // The cover was handed to the publish flow (6th arg is the selected File)…
    expect(onPublish.mock.calls[0][5]).toBeInstanceOf(File);
    // …and because publish was blocked, the cover selection MUST remain.
    expect(screen.getByAltText("Cover preview")).toBeInTheDocument();
  });

  it("clears the cover preview once onPublish resolves truthy (publish attempted)", async () => {
    const onPublish = vi.fn().mockResolvedValue(true);
    await renderWithSelectedCover(onPublish);

    fireEvent.click(await screen.findByRole("button", { name: "Publish to PlotLink" }));

    await waitFor(() => expect(screen.queryByAltText("Cover preview")).not.toBeInTheDocument());
  });
});
