// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { StoryBrowser } from "./StoryBrowser";

afterEach(cleanup);

const STORY = {
  name: "god-cell",
  title: "God Cell",
  files: [
    { file: "structure.md", status: "draft" },
    { file: "genesis.md", status: "pending" },
    { file: "plot-01.md", status: "pending" },
  ],
  hasStructure: true,
  hasGenesis: true,
  plotCount: 1,
  publishedCount: 0,
  contentType: "cartoon",
};

const FICTION_STORY = {
  name: "novel",
  title: "A Novel",
  files: [
    { file: "structure.md", status: "draft" },
    { file: "genesis.md", status: "pending" },
    { file: "plot-01.md", status: "pending" },
    { file: "plot-02.md", status: "pending" },
  ],
  hasStructure: true,
  hasGenesis: true,
  plotCount: 2,
  publishedCount: 0,
  contentType: "fiction",
};

function makeAuthFetch(stories: unknown[] = [STORY]) {
  return vi.fn((url: string) => {
    if (url === "/api/stories") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ stories }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ stories: [] }) });
  });
}

describe("StoryBrowser story-root click → progress overview (#418)", () => {
  it("already-expanded + a file selected: root click still switches to the overview (@re1 case)", async () => {
    // selectedStory auto-expands on mount, so this story is expanded with a file
    // selected — exactly the flagged case where collapsing must NOT leave the
    // file preview showing.
    const onSelectFile = vi.fn();
    render(
      <StoryBrowser authFetch={makeAuthFetch()} selectedStory="god-cell" selectedFile="plot-01.md" onSelectFile={onSelectFile} />,
    );
    const root = (await screen.findByText("God Cell")).closest("button")!;
    fireEvent.click(root);
    expect(onSelectFile).toHaveBeenLastCalledWith("god-cell", "");
  });

  it("collapsed story: root click expands AND opens the overview", async () => {
    const onSelectFile = vi.fn();
    render(
      <StoryBrowser authFetch={makeAuthFetch()} selectedStory={null} selectedFile={null} onSelectFile={onSelectFile} />,
    );
    const root = (await screen.findByText("God Cell")).closest("button")!;
    fireEvent.click(root);
    expect(onSelectFile).toHaveBeenLastCalledWith("god-cell", "");
    // File list expanded → a specific file row is now reachable and opens that file.
    fireEvent.click((await screen.findByText("epi-01 (Genesis)")).closest("button")!);
    expect(onSelectFile).toHaveBeenLastCalledWith("god-cell", "genesis.md");
  });

  it("FICTION root click preserves auto-open-latest-file (not the overview)", async () => {
    // Fiction must keep its existing behavior: clicking the story opens the
    // latest file (highest plot), not the progress overview (#418 / @re1).
    const onSelectFile = vi.fn();
    render(
      <StoryBrowser authFetch={makeAuthFetch([FICTION_STORY])} selectedStory={null} selectedFile={null} onSelectFile={onSelectFile} />,
    );
    fireEvent.click((await screen.findByText("A Novel")).closest("button")!);
    expect(onSelectFile).toHaveBeenLastCalledWith("novel", "plot-02.md");
    expect(onSelectFile).not.toHaveBeenCalledWith("novel", "");
  });
});
