// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { StoryProgressPanel } from "./StoryProgressPanel";
import type { StoryProgress } from "@app-lib/story-progress";

afterEach(cleanup);

const PROGRESS: StoryProgress = {
  name: "god-cell",
  contentType: "cartoon",
  metadata: { title: "신의 세포", language: "Korean", genre: "Science Fiction", isNsfw: false, contentType: "cartoon" },
  setup: { hasStructure: true, hasGenesis: true },
  cover: "missing",
  episodes: [
    { file: "genesis.md", label: "Episode 1 / Genesis", kind: "genesis", title: "Awakening", state: "ready", summary: "Ready to publish", published: false, cuts: { total: 2, withClean: 2, exported: 2, uploaded: 2 } },
    { file: "plot-01.md", label: "Episode 2", kind: "plot", title: null, state: "placeholder", summary: "Not started — no cuts planned yet", published: false, cuts: { total: 0, withClean: 0, exported: 0, uploaded: 0 } },
  ],
  summary: { episodes: 2, published: 0, readyToPublish: 1, placeholders: 1, blocked: 0 },
  nextAction: "Create or import a cover image for the story.",
  nextPrompt: null,
};

function makeAuthFetch(progress: StoryProgress | null = PROGRESS) {
  return vi.fn((url: string) => {
    if (url.endsWith("/progress")) {
      return Promise.resolve({ ok: progress != null, status: progress ? 200 : 404, json: () => Promise.resolve(progress) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("StoryProgressPanel (#418)", () => {
  it("renders metadata, the single next action, and per-episode states", async () => {
    render(<StoryProgressPanel storyName="god-cell" authFetch={makeAuthFetch()} onOpenFile={vi.fn()} />);

    expect(await screen.findByTestId("story-progress-panel")).toBeInTheDocument();
    expect(screen.getByTestId("progress-next-action")).toHaveTextContent(/cover image/i);

    const genesis = screen.getByTestId("progress-episode-genesis.md");
    expect(genesis).toHaveAttribute("data-state", "ready");
    expect(genesis).toHaveTextContent("Episode 1 / Genesis");

    // The placeholder plot reads as "Not started", never "Ready to publish".
    const plot = screen.getByTestId("progress-episode-plot-01.md");
    expect(plot).toHaveAttribute("data-state", "placeholder");
    expect(plot).toHaveTextContent(/not started/i);
    expect(plot).not.toHaveTextContent(/Ready/);

    expect(screen.getByTestId("progress-summary")).toHaveTextContent("1 not started");
  });

  it("opens the relevant file when an episode row is clicked", async () => {
    const onOpenFile = vi.fn();
    render(<StoryProgressPanel storyName="god-cell" authFetch={makeAuthFetch()} onOpenFile={onOpenFile} />);
    fireEvent.click(await screen.findByTestId("progress-episode-plot-01.md"));
    expect(onOpenFile).toHaveBeenCalledWith("god-cell", "plot-01.md");
  });

  it("shows a copy-paste next prompt with a Copy button when one is available (#423)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const withPrompt: StoryProgress = { ...PROGRESS, nextPrompt: "Let's start this cartoon. Write the story bible (structure.md)…" };
    render(<StoryProgressPanel storyName="god-cell" authFetch={makeAuthFetch(withPrompt)} onOpenFile={vi.fn()} />);

    const prompt = await screen.findByTestId("progress-next-prompt");
    expect(prompt).toHaveTextContent(/Write the story bible/i);
    fireEvent.click(screen.getByTestId("copy-next-prompt"));
    expect(writeText).toHaveBeenCalledWith("Let's start this cartoon. Write the story bible (structure.md)…");
  });

  it("shows a friendly error if progress cannot be loaded", async () => {
    render(<StoryProgressPanel storyName="missing" authFetch={makeAuthFetch(null)} onOpenFile={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Could not load story progress/i)).toBeInTheDocument());
  });
});
