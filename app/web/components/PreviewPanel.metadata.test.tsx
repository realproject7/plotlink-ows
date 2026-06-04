// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";

afterEach(cleanup);

/**
 * #424: the publish metadata controls must seed from the story's real
 * .story.json values (passed down as props) instead of the first-in-list
 * defaults (Romance / English), show an explicit "Needs metadata" state when a
 * genre is unset, and persist edits back to .story.json.
 */

const GENESIS = {
  file: "genesis.md",
  status: "draft",
  content:
    "# Neural Bloom\n\nA quiet lab hums as the first synthetic cell divides on the slide, and Dr. Han knows nothing about the world will stay the same after tonight.",
};

/** authFetch double: genesis file on GET, empty structure.md (no inline genre/
 * language hints, so the props are what seed the controls), records POSTs. */
function makeAuthFetch() {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fn = vi.fn((url: string, opts?: RequestInit) => {
    calls.push({ url, method: opts?.method ?? "GET", body: opts?.body });
    if (url.endsWith("/structure.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: "" }) });
    }
    if (url.includes("/api/stories/") && (!opts || (opts.method ?? "GET") === "GET")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(GENESIS) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  });
  return { fn, calls };
}

function renderPanel(props: { genre?: string; language?: string; isNsfw?: boolean }, calls = makeAuthFetch()) {
  render(
    <PreviewPanel
      storyName="god-cell"
      fileName="genesis.md"
      authFetch={calls.fn}
      onPublish={vi.fn()}
      publishingFile={null}
      walletAddress="test-wallet-address"
      contentType="fiction"
      {...props}
    />,
  );
  return calls;
}

describe("PreviewPanel publish metadata seeding (#424)", () => {
  it("seeds genre + language from .story.json props (god-cell ⇒ Korean / Science Fiction)", async () => {
    renderPanel({ genre: "Science Fiction", language: "Korean", isNsfw: false });
    const genre = (await screen.findByTestId("publish-genre-select")) as HTMLSelectElement;
    const language = screen.getByTestId("publish-language-select") as HTMLSelectElement;
    await waitFor(() => {
      expect(genre.value).toBe("Science Fiction");
      expect(language.value).toBe("Korean");
    });
    // Not the misleading defaults.
    expect(genre.value).not.toBe("Romance");
    expect(language.value).not.toBe("English");
    expect(screen.queryByTestId("genre-needs-metadata")).not.toBeInTheDocument();
  });

  it("canonicalizes a non-canonical stored genre label (Sci-Fi ⇒ Science Fiction)", async () => {
    renderPanel({ genre: "Sci-Fi", language: "Korean" });
    const genre = (await screen.findByTestId("publish-genre-select")) as HTMLSelectElement;
    await waitFor(() => expect(genre.value).toBe("Science Fiction"));
  });

  it("shows Needs metadata and disables publish when no genre is set anywhere", async () => {
    renderPanel({ language: "English" }); // no genre prop, empty structure.md
    const genre = (await screen.findByTestId("publish-genre-select")) as HTMLSelectElement;
    await waitFor(() => expect(genre.value).toBe("")); // explicit unset, not Romance
    expect(screen.getByTestId("genre-needs-metadata")).toBeInTheDocument();
    expect(screen.getByText("Publish to PlotLink").closest("button")).toBeDisabled();
  });

  it("persists a genre change back to .story.json and re-enables publish", async () => {
    const calls = renderPanel({ language: "English" });
    const genre = (await screen.findByTestId("publish-genre-select")) as HTMLSelectElement;
    await waitFor(() => expect(genre.value).toBe(""));

    fireEvent.change(genre, { target: { value: "Mystery" } });

    await waitFor(() => {
      const post = calls.calls.find(
        (c) => c.url.endsWith("/api/stories/god-cell/publish-metadata") && c.method === "POST",
      );
      expect(post).toBeTruthy();
      expect(JSON.parse(post!.body as string)).toEqual({ genre: "Mystery" });
    });
    expect(screen.queryByTestId("genre-needs-metadata")).not.toBeInTheDocument();
    expect(screen.getByText("Publish to PlotLink").closest("button")).not.toBeDisabled();
  });

  it("persists an isNsfw toggle back to .story.json", async () => {
    const calls = renderPanel({ genre: "Romance", language: "English", isNsfw: false });
    await screen.findByTestId("publish-genre-select");
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    await waitFor(() => {
      const post = calls.calls.find(
        (c) => c.url.endsWith("/api/stories/god-cell/publish-metadata") && c.method === "POST",
      );
      expect(post).toBeTruthy();
      expect(JSON.parse(post!.body as string)).toEqual({ isNsfw: true });
    });
  });
});
