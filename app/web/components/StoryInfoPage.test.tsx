// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { StoryInfoPage } from "./StoryInfoPage";

afterEach(cleanup);

const DETAIL = {
  name: "god-cell", title: "신의 세포", description: "A CERN SF mystery webtoon.",
  genre: "Science Fiction", language: "Korean", isNsfw: false, contentType: "cartoon",
};

/** authFetch routing GET detail / GET progress / POST publish-metadata. Captures the saved body. */
function makeAuthFetch(opts: { detail?: unknown; cover?: string; saveOk?: boolean; saved?: { body?: unknown } } = {}) {
  const { detail = DETAIL, cover = "missing", saveOk = true, saved = {} } = opts;
  return vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/publish-metadata")) {
      saved.body = init?.body ? JSON.parse(init.body as string) : undefined;
      return Promise.resolve({ ok: saveOk, status: saveOk ? 200 : 500, json: () => Promise.resolve(saveOk ? { ok: true } : { error: "nope" }) });
    }
    if (url.endsWith("/progress")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cover }) });
    }
    // story detail
    return Promise.resolve({ ok: detail != null, status: detail ? 200 : 404, json: () => Promise.resolve(detail) });
  });
}

describe("StoryInfoPage (#439)", () => {
  it("loads the current metadata into the form and locks content type", async () => {
    render(<StoryInfoPage storyName="god-cell" authFetch={makeAuthFetch()} />);
    expect(await screen.findByTestId("story-info-page")).toBeInTheDocument();

    expect(screen.getByTestId("story-info-title")).toHaveValue("신의 세포");
    expect(screen.getByTestId("story-info-description")).toHaveValue("A CERN SF mystery webtoon.");
    expect(screen.getByTestId("story-info-genre")).toHaveValue("Science Fiction");
    expect(screen.getByTestId("story-info-language")).toHaveValue("Korean");
    expect(screen.getByTestId("story-info-content-type")).toHaveTextContent(/Cartoon · locked/);
    expect(screen.getByTestId("story-info-cover-status")).toHaveTextContent(/Missing cover/i);
  });

  it("persists edited fields via /publish-metadata and reports saved", async () => {
    const saved: { body?: unknown } = {};
    const onSaved = vi.fn();
    render(<StoryInfoPage storyName="god-cell" authFetch={makeAuthFetch({ saved })} onSaved={onSaved} />);
    await screen.findByTestId("story-info-page");

    fireEvent.change(screen.getByTestId("story-info-title"), { target: { value: "New Title" } });
    fireEvent.change(screen.getByTestId("story-info-description"), { target: { value: "New blurb" } });
    fireEvent.change(screen.getByTestId("story-info-genre"), { target: { value: "Thriller" } });
    fireEvent.click(screen.getByTestId("story-info-nsfw"));
    fireEvent.click(screen.getByTestId("story-info-save"));

    await waitFor(() => expect(screen.getByTestId("story-info-saved")).toBeInTheDocument());
    expect(saved.body).toEqual({ title: "New Title", description: "New blurb", genre: "Thriller", language: "Korean", isNsfw: true });
    // Parent is told the publish-relevant fields so its seeds stay in sync.
    expect(onSaved).toHaveBeenCalledWith({ genre: "Thriller", language: "Korean", isNsfw: true });
  });

  it("surfaces a save error", async () => {
    render(<StoryInfoPage storyName="god-cell" authFetch={makeAuthFetch({ saveOk: false })} />);
    await screen.findByTestId("story-info-page");
    fireEvent.click(screen.getByTestId("story-info-save"));
    await waitFor(() => expect(screen.getByTestId("story-info-error")).toBeInTheDocument());
  });

  it("shows a friendly error when the story cannot be loaded", async () => {
    render(<StoryInfoPage storyName="missing" authFetch={makeAuthFetch({ detail: null })} />);
    await waitFor(() => expect(screen.getByText(/Could not load story info/i)).toBeInTheDocument());
  });
});
