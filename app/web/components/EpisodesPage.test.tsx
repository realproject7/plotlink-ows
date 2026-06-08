// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EpisodesPage } from "./EpisodesPage";
import type { StoryProgress } from "@app-lib/story-progress";

afterEach(cleanup);

const PROGRESS: Partial<StoryProgress> = {
  episodes: [
    { file: "genesis.md", label: "Episode 1 / Genesis", kind: "genesis", title: "Awakening", state: "ready", summary: "Ready to publish", published: false, checklist: [], cuts: null },
    { file: "plot-01.md", label: "Episode 2", kind: "plot", title: null, state: "placeholder", summary: "Not started — no cuts planned yet", published: false, checklist: [], cuts: null },
  ],
};

function makeAuthFetch(progress: Partial<StoryProgress> | null = PROGRESS) {
  return vi.fn((url: string) => {
    if (url.endsWith("/progress")) {
      return Promise.resolve({ ok: progress != null, status: progress ? 200 : 404, json: () => Promise.resolve(progress) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("EpisodesPage (#439)", () => {
  it("lists episodes in reader order with episode-centric labels", async () => {
    render(<EpisodesPage storyName="god-cell" authFetch={makeAuthFetch()} onOpenFile={vi.fn()} />);
    expect(await screen.findByTestId("episodes-page")).toBeInTheDocument();
    expect(screen.getByTestId("episodes-summary")).toHaveTextContent("2 total");
    expect(screen.getByTestId("episodes-summary")).toHaveTextContent("1 ready");
    expect(screen.getByTestId("episodes-row-genesis.md")).toHaveTextContent("epi-01 (Genesis)");
    expect(screen.getByTestId("episodes-row-plot-01.md")).toHaveTextContent("epi-02");
  });

  it("opens the file when an episode row is clicked", async () => {
    const onOpenFile = vi.fn();
    render(<EpisodesPage storyName="god-cell" authFetch={makeAuthFetch()} onOpenFile={onOpenFile} />);
    fireEvent.click(await screen.findByTestId("episodes-row-plot-01.md"));
    expect(onOpenFile).toHaveBeenCalledWith("god-cell", "plot-01.md");
  });

  it("shows an empty state when there are no episodes", async () => {
    render(<EpisodesPage storyName="god-cell" authFetch={makeAuthFetch({ episodes: [] })} onOpenFile={vi.fn()} />);
    expect(await screen.findByTestId("episodes-empty")).toBeInTheDocument();
  });
});
