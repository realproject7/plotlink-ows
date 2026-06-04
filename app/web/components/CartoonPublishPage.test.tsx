// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { CartoonPublishPage } from "./CartoonPublishPage";
import type { StoryProgress, EpisodeProgress } from "@app-lib/story-progress";

afterEach(cleanup);

function ep(o: Partial<EpisodeProgress> & { file: string }): EpisodeProgress {
  return {
    file: o.file, label: o.label ?? "Episode 1 / Genesis", kind: o.kind ?? "genesis", title: o.title ?? null,
    state: o.state ?? "planning", summary: o.summary ?? "", published: o.published ?? false,
    checklist: o.checklist ?? null, cuts: o.cuts ?? null,
  };
}

function progress(o: Partial<StoryProgress> & { episodes: EpisodeProgress[] }): StoryProgress {
  return {
    name: "god-cell", contentType: "cartoon",
    metadata: { title: "신의 세포", language: "Korean", genre: "Science Fiction", isNsfw: false, contentType: "cartoon" },
    setup: { hasStructure: true, hasGenesis: true }, cover: o.cover ?? "present",
    episodes: o.episodes,
    summary: { episodes: o.episodes.length, published: 0, readyToPublish: 0, placeholders: 0, blocked: 0 },
    nextAction: null, nextPrompt: null,
  };
}

function makeAuthFetch(p: StoryProgress | null) {
  return vi.fn((url: string) => {
    if (url.endsWith("/progress")) return Promise.resolve({ ok: p != null, status: p ? 200 : 404, json: () => Promise.resolve(p) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

const READY_CUTS = { total: 10, needClean: 10, withClean: 10, withText: 10, exported: 10, uploaded: 10 };
const MIDWAY_CUTS = { total: 10, needClean: 10, withClean: 10, withText: 0, exported: 0, uploaded: 0 };

describe("CartoonPublishPage (#449)", () => {
  it("summarizes readiness for the active episode and disables Publish until ready", async () => {
    const p = progress({ cover: "present", episodes: [ep({ file: "genesis.md", state: "in-progress", summary: "3 / 10 cuts have uploaded images", cuts: MIDWAY_CUTS })] });
    render(<CartoonPublishPage storyName="god-cell" authFetch={makeAuthFetch(p)} onOpenFile={vi.fn()} onOpenStoryInfo={vi.fn()} />);

    expect(await screen.findByTestId("cartoon-publish-page")).toHaveTextContent("Publish Episode 1 / Genesis");
    const checklist = screen.getByTestId("publish-checklist");
    expect(checklist).toHaveTextContent("Cuts lettered");
    expect(checklist).toHaveTextContent("Final images uploaded");
    // Not ready → the publish CTA is disabled and a reason is shown.
    expect(screen.getByTestId("publish-cta")).toBeDisabled();
    expect(screen.getByTestId("publish-blocked-reason")).toBeInTheDocument();
  });

  it("enables 'Review & publish' for a ready episode and routes it to the episode controls", async () => {
    const onOpenFile = vi.fn();
    const p = progress({ cover: "present", episodes: [ep({ file: "genesis.md", state: "ready", summary: "Ready to publish", cuts: READY_CUTS })] });
    render(<CartoonPublishPage storyName="god-cell" authFetch={makeAuthFetch(p)} onOpenFile={onOpenFile} onOpenStoryInfo={vi.fn()} />);

    const cta = await screen.findByTestId("publish-cta");
    expect(cta).not.toBeDisabled();
    expect(cta).toHaveTextContent(/Review & publish/);
    fireEvent.click(cta);
    expect(onOpenFile).toHaveBeenCalledWith("god-cell", "genesis.md");
  });

  it("offers an Add-cover action routing to Story Info when the cover is missing", async () => {
    const onOpenStoryInfo = vi.fn();
    const p = progress({ cover: "missing", episodes: [ep({ file: "genesis.md", state: "ready", summary: "Ready to publish", cuts: READY_CUTS })] });
    render(<CartoonPublishPage storyName="god-cell" authFetch={makeAuthFetch(p)} onOpenFile={vi.fn()} onOpenStoryInfo={onOpenStoryInfo} />);

    fireEvent.click(await screen.findByTestId("publish-add-cover"));
    expect(onOpenStoryInfo).toHaveBeenCalled();
    // The cover check reads as not-done.
    const coverRow = within(screen.getByTestId("publish-checklist")).getByText("Cover image");
    expect(coverRow.closest("[data-testid='publish-check']")).toHaveAttribute("data-status", "todo");
  });

  it("shows an all-published state when every episode is published", async () => {
    const p = progress({ episodes: [ep({ file: "genesis.md", state: "published", published: true })] });
    render(<CartoonPublishPage storyName="god-cell" authFetch={makeAuthFetch(p)} onOpenFile={vi.fn()} onOpenStoryInfo={vi.fn()} />);
    expect(await screen.findByTestId("publish-all-done")).toBeInTheDocument();
  });

  it("shows a friendly error when readiness cannot load", async () => {
    render(<CartoonPublishPage storyName="missing" authFetch={makeAuthFetch(null)} onOpenFile={vi.fn()} onOpenStoryInfo={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Could not load publish readiness/i)).toBeInTheDocument());
  });
});
