// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { StoryProgressPanel } from "./StoryProgressPanel";
import type { StoryProgress } from "@app-lib/story-progress";
import type { CartoonChecklistStep } from "@app-lib/cartoon-readiness";

afterEach(cleanup);

const genesisChecklist: CartoonChecklistStep[] = [
  { key: "plan", label: "Plan cuts", status: "done", detail: "2 / 2 cuts" },
  { key: "clean", label: "Create clean images", status: "done", detail: "2 / 2 cuts" },
  { key: "letter", label: "Add speech bubbles & captions", status: "done", detail: "2 / 2 cuts" },
  { key: "export", label: "Export final images", status: "done", detail: "2 / 2 cuts" },
  { key: "upload", label: "Upload final images", status: "done", detail: "2 / 2 cuts" },
  { key: "publish", label: "Publish to PlotLink", status: "current", detail: null },
];

// Cartoon story: Genesis (Episode 1) is the active step (coach targets it),
// plot-01 (Episode 2) is a not-started placeholder.
const CARTOON: StoryProgress = {
  name: "god-cell",
  contentType: "cartoon",
  metadata: { title: "신의 세포", language: "Korean", genre: "Science Fiction", isNsfw: false, contentType: "cartoon" },
  setup: { hasStructure: true, hasGenesis: true },
  cover: "missing",
  episodes: [
    { file: "genesis.md", label: "Episode 1 / Genesis", kind: "genesis", title: "Awakening", state: "ready", summary: "Ready to publish", published: false, checklist: genesisChecklist, cuts: { total: 2, needClean: 2, withClean: 2, withText: 2, exported: 2, uploaded: 2 } },
    { file: "plot-01.md", label: "Episode 2", kind: "plot", title: null, state: "placeholder", summary: "Not started — no cuts planned yet", published: false, checklist: [], cuts: { total: 0, needClean: 0, withClean: 0, withText: 0, exported: 0, uploaded: 0 } },
  ],
  summary: { episodes: 2, published: 0, readyToPublish: 1, placeholders: 1, blocked: 0 },
  nextAction: "Publish Episode 1 / Genesis.",
  nextPrompt: null,
  coach: { stageLabel: "Ready to publish", action: "Publish Episode 1 / Genesis to PlotLink", actionKind: "ui", prompt: null, uiAction: "publish", episodeFile: "genesis.md" },
};

const FICTION: StoryProgress = {
  name: "tidewright",
  contentType: "fiction",
  metadata: { title: "Tidewright", language: "English", genre: "Fantasy", isNsfw: false, contentType: "fiction" },
  setup: { hasStructure: true, hasGenesis: true },
  cover: "present",
  episodes: [
    { file: "genesis.md", label: "Genesis", kind: "genesis", title: null, state: "published", summary: "Published to PlotLink", published: true, checklist: null, cuts: null },
    { file: "plot-01.md", label: "Chapter 1", kind: "plot", title: null, state: "draft", summary: "Drafted — ready to review and publish", published: false, checklist: null, cuts: null },
  ],
  summary: { episodes: 2, published: 1, readyToPublish: 0, placeholders: 0, blocked: 0 },
  nextAction: "Review and publish Chapter 1.",
  nextPrompt: null,
};

function makeAuthFetch(progress: StoryProgress | null = CARTOON) {
  return vi.fn((url: string) => {
    if (url.endsWith("/progress")) {
      return Promise.resolve({ ok: progress != null, status: progress ? 200 : 404, json: () => Promise.resolve(progress) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("StoryProgressPanel — cartoon workflow map (#438)", () => {
  it("renders numbered sections in workflow order: Story Info → Whitepaper → Episode 1 → Episode 2", async () => {
    render(<StoryProgressPanel storyName="god-cell" authFetch={makeAuthFetch()} onOpenFile={vi.fn()} />);
    await screen.findByTestId("story-progress-panel");

    expect(screen.getByTestId("workflow-section-1")).toHaveTextContent("Define Story Info");
    expect(screen.getByTestId("workflow-section-2")).toHaveTextContent("Story Whitepaper");
    // Genesis is Episode 1; plot-01 is Episode 2.
    expect(screen.getByTestId("workflow-section-3")).toHaveTextContent("Episode 1 / Genesis");
    expect(screen.getByTestId("workflow-section-4")).toHaveTextContent("Episode 2");
  });

  it("places exactly one next-action CTA, inside the active (current) section", async () => {
    render(<StoryProgressPanel storyName="god-cell" authFetch={makeAuthFetch()} onOpenFile={vi.fn()} />);
    await screen.findByTestId("story-progress-panel");

    // Only one CTA on the whole page (no duplicated global coach bar).
    expect(screen.getAllByTestId("section-cta")).toHaveLength(1);
    expect(screen.getAllByTestId("workflow-coach")).toHaveLength(1);

    // The active step is Genesis (coach targets genesis.md) → the CTA lives in
    // section 3, not in Story Info / Whitepaper / Episode 2.
    const genesisSection = screen.getByTestId("workflow-section-3");
    expect(within(genesisSection).getByTestId("workflow-coach")).toHaveTextContent(/Publish/);
    expect(genesisSection).toHaveAttribute("data-status", "current");
    expect(within(screen.getByTestId("workflow-section-1")).queryByTestId("section-cta")).toBeNull();
    expect(within(screen.getByTestId("workflow-section-4")).queryByTestId("section-cta")).toBeNull();
  });

  it("clicking the active CTA routes to the episode it concerns", async () => {
    const onOpenFile = vi.fn();
    render(<StoryProgressPanel storyName="god-cell" authFetch={makeAuthFetch()} onOpenFile={onOpenFile} />);
    await screen.findByTestId("story-progress-panel");
    fireEvent.click(screen.getByTestId("workflow-coach-do"));
    expect(onOpenFile).toHaveBeenCalledWith("god-cell", "genesis.md");
  });

  it("shows per-step checklist items and a Missing cover row in Story Info", async () => {
    render(<StoryProgressPanel storyName="god-cell" authFetch={makeAuthFetch()} onOpenFile={vi.fn()} />);
    await screen.findByTestId("story-progress-panel");

    const info = screen.getByTestId("workflow-section-1");
    expect(info).toHaveAttribute("data-status", "needs-action"); // cover missing
    expect(info).toHaveTextContent("Public title");
    expect(info).toHaveTextContent(/Cover image/);
    expect(info).toHaveTextContent(/Missing/);

    // The Genesis section shows the production checklist labels.
    const genesis = screen.getByTestId("workflow-section-3");
    expect(genesis).toHaveTextContent("Opening text");
    expect(genesis).toHaveTextContent("Create clean images");
    expect(genesis).toHaveTextContent("Upload final images");
  });

  it("opens the episode file when its section header is clicked", async () => {
    const onOpenFile = vi.fn();
    render(<StoryProgressPanel storyName="god-cell" authFetch={makeAuthFetch()} onOpenFile={onOpenFile} />);
    fireEvent.click(await screen.findByTestId("progress-episode-plot-01.md"));
    expect(onOpenFile).toHaveBeenCalledWith("god-cell", "plot-01.md");
  });

  it("renders a not-started stub for a placeholder episode", async () => {
    render(<StoryProgressPanel storyName="god-cell" authFetch={makeAuthFetch()} onOpenFile={vi.fn()} />);
    await screen.findByTestId("story-progress-panel");
    const ep2 = screen.getByTestId("workflow-section-4");
    expect(ep2).toHaveAttribute("data-status", "not-started");
    expect(ep2).toHaveTextContent("Cut plan");
    expect(ep2).toHaveTextContent("Clean artwork");
  });

  it("shows a friendly error if progress cannot be loaded", async () => {
    render(<StoryProgressPanel storyName="missing" authFetch={makeAuthFetch(null)} onOpenFile={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Could not load story progress/i)).toBeInTheDocument());
  });
});

describe("StoryProgressPanel — fiction keeps the simpler layout", () => {
  it("renders the plain next-action line and a Chapters list, not the cartoon map", async () => {
    render(<StoryProgressPanel storyName="tidewright" authFetch={makeAuthFetch(FICTION)} onOpenFile={vi.fn()} />);
    await screen.findByTestId("story-progress-panel");

    // No cartoon sections.
    expect(screen.queryByTestId("workflow-section-1")).toBeNull();
    // The original next-action line is present.
    expect(screen.getByTestId("progress-next-action")).toHaveTextContent(/Chapter 1/);
    // Chapter labels, not Episode labels.
    const ch1 = screen.getByTestId("progress-episode-plot-01.md");
    expect(ch1).toHaveTextContent("Chapter 1");
    expect(ch1).toHaveAttribute("data-state", "draft");
  });

  it("opens a chapter file when clicked", async () => {
    const onOpenFile = vi.fn();
    render(<StoryProgressPanel storyName="tidewright" authFetch={makeAuthFetch(FICTION)} onOpenFile={onOpenFile} />);
    fireEvent.click(await screen.findByTestId("progress-episode-plot-01.md"));
    expect(onOpenFile).toHaveBeenCalledWith("tidewright", "plot-01.md");
  });
});
