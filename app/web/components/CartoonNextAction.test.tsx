// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CartoonNextActionView } from "./CartoonNextAction";

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("CartoonNextActionView", () => {
  it("renders the compact Story Info CTA when cover metadata is the current gate", () => {
    const onOpenStoryInfo = vi.fn();
    render(
      <CartoonNextActionView
        progress={{
          name: "god-cell",
          contentType: "cartoon",
          metadata: {
            title: "God Cell",
            language: "English",
            genre: "Science Fiction",
            isNsfw: false,
            contentType: "cartoon",
          },
          setup: { hasStructure: true, hasGenesis: true },
          cover: "missing",
          episodes: [],
          summary: {
            episodes: 0,
            published: 0,
            readyToPublish: 0,
            placeholders: 0,
            blocked: 0,
          },
          nextAction: "Add a cover image before publishing.",
          nextPrompt: null,
          coach: null,
        }}
        onCoachAction={vi.fn()}
        onOpenStoryInfo={onOpenStoryInfo}
      />,
    );

    const cta = screen.getByTestId("story-info-cta");
    expect(cta).toHaveTextContent("Next: Add a cover image before publishing.");
    fireEvent.click(screen.getByRole("button", { name: "Next Action" }));
    expect(onOpenStoryInfo).toHaveBeenCalledTimes(1);
  });

  it("renders the compact workflow CTA and routes UI actions without the old card shell", () => {
    const onCoachAction = vi.fn();
    render(
      <CartoonNextActionView
        progress={{
          name: "god-cell",
          contentType: "cartoon",
          metadata: {
            title: "God Cell",
            language: "English",
            genre: "Science Fiction",
            isNsfw: false,
            contentType: "cartoon",
          },
          setup: { hasStructure: true, hasGenesis: true },
          cover: "present",
          episodes: [
            {
              file: "genesis.md",
              label: "Episode 1 / Genesis",
              kind: "genesis",
              title: "Opening",
              state: "blocked",
              summary: "Needs lettering",
              published: false,
              checklist: [],
              cuts: {
                total: 2,
                needClean: 0,
                withClean: 2,
                withText: 0,
                exported: 0,
                uploaded: 0,
              },
            },
          ],
          summary: {
            episodes: 1,
            published: 0,
            readyToPublish: 0,
            placeholders: 0,
            blocked: 1,
          },
          nextAction: "Review cuts and start lettering.",
          nextPrompt: null,
          coach: {
            stageLabel: "Clean images ready",
            action: "Review cuts and start lettering",
            actionKind: "ui",
            prompt: null,
            uiAction: "open-lettering",
            episodeFile: "genesis.md",
          },
        }}
        onCoachAction={onCoachAction}
      />,
    );

    expect(screen.getByTestId("cartoon-next-action")).toHaveTextContent(
      "Next: Review cuts and start lettering",
    );
    expect(screen.queryByTestId("workflow-coach")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("workflow-coach-do"));
    expect(onCoachAction).toHaveBeenCalledWith("open-lettering", "genesis.md");
  });
});
