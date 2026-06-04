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

// A publishable Genesis opening (real H1 + multi-paragraph prose) so the migrated
// title (#358) and prologue-readiness (#359) diagnostics don't block publish in
// the ready-state tests. Override per test via the `files` map.
const GOOD_GENESIS = `# The Awakening

In a quiet lab as the night shift ends, a single cell stirs to life for the first time. It does not yet know what it is, only that the world around it hums with a strange new purpose.

By dawn, nothing in the building — or the city beyond it — will be the same. The researchers who built it are about to learn that creation answers to no one. This is where the story of the god cell begins.`;

function makeAuthFetch(p: StoryProgress | null, files?: Record<string, unknown>) {
  const map: Record<string, unknown> = {
    content: { content: GOOD_GENESIS },
    cuts: { cuts: [], title: null },
    structure: { content: "# The Awakening\n" },
    ...files,
  };
  return vi.fn((url: string) => {
    if (url.endsWith("/progress")) return Promise.resolve({ ok: p != null, status: p ? 200 : 404, json: () => Promise.resolve(p) });
    if (url.includes("/cuts/")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(map.cuts) });
    if (url.endsWith("/structure.md")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(map.structure) });
    if (/\/stories\/[^/]+\/[^/]+\.md$/.test(url)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(map.content) });
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

  // #461: the Publish tab now hosts the actual publish action (it used to route
  // into the episode). A ready Genesis with genre+language publishes via onPublish.
  it("publishes a ready episode via onPublish from the Publish tab", async () => {
    const onPublish = vi.fn().mockResolvedValue(true);
    const p = progress({ cover: "present", episodes: [ep({ file: "genesis.md", state: "ready", summary: "Ready to publish", cuts: READY_CUTS })] });
    render(<CartoonPublishPage storyName="god-cell" authFetch={makeAuthFetch(p)} onOpenFile={vi.fn()} onOpenStoryInfo={vi.fn()} onPublish={onPublish} genre="Science Fiction" language="Korean" />);

    const cta = await screen.findByTestId("publish-cta");
    await waitFor(() => expect(cta).not.toBeDisabled());
    expect(cta).toHaveTextContent(/Publish .* to PlotLink/);
    fireEvent.click(cta);
    await waitFor(() => expect(onPublish).toHaveBeenCalled());
    const args = onPublish.mock.calls[0];
    expect(args[0]).toBe("god-cell");
    expect(args[1]).toBe("genesis.md");
    expect(args[2]).toBe("Science Fiction");
    expect(args[3]).toBe("Korean");
  });

  // #461: a ready Genesis with no genre/language can't publish — Genesis needs
  // metadata (set in Story Info), so the button stays disabled with a hint.
  it("blocks publishing a ready Genesis until genre+language are set in Story Info", async () => {
    const onPublish = vi.fn();
    const p = progress({ cover: "present", episodes: [ep({ file: "genesis.md", state: "ready", summary: "Ready to publish", cuts: READY_CUTS })] });
    render(<CartoonPublishPage storyName="god-cell" authFetch={makeAuthFetch(p)} onOpenFile={vi.fn()} onOpenStoryInfo={vi.fn()} onPublish={onPublish} />);

    const cta = await screen.findByTestId("publish-cta");
    expect(cta).toBeDisabled();
    expect(screen.getByTestId("publish-needs-metadata")).toBeInTheDocument();
    expect(screen.getByTestId("publish-set-metadata")).toBeInTheDocument();
    fireEvent.click(cta);
    expect(onPublish).not.toHaveBeenCalled();
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

  // #461: the publish-title diagnostic (#358) moved here from the episode view.
  // A Genesis with no real heading would publish as a raw filename → blocked.
  it("blocks publish when the Genesis title is still a raw filename (#358)", async () => {
    const onPublish = vi.fn();
    // No H1 anywhere AND a slug that prettifies to the raw "genesis" label.
    const p = progress({ cover: "present", episodes: [ep({ file: "genesis.md", label: "Genesis", state: "ready", summary: "Ready to publish", cuts: READY_CUTS })] });
    const auth = makeAuthFetch(p, { content: { content: "Just a paragraph with no title heading at all." }, structure: { content: "" } });
    // storyName "genesis" so prettifyStorySlug → "Genesis" → raw-title block.
    render(<CartoonPublishPage storyName="genesis" authFetch={auth} onOpenFile={vi.fn()} onOpenStoryInfo={vi.fn()} onPublish={onPublish} genre="Science Fiction" language="Korean" />);

    const title = await screen.findByTestId("publish-title-preview");
    expect(title).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("publish-title-raw-error")).toBeInTheDocument();
    expect(screen.getByTestId("publish-cta")).toBeDisabled();
    fireEvent.click(screen.getByTestId("publish-cta"));
    expect(onPublish).not.toHaveBeenCalled();
  });

  // #461: the Genesis prologue-readiness diagnostic (#359) moved here. A thin /
  // synopsis-shaped opening surfaces a blocker and disables publish.
  it("shows a Genesis readiness blocker and disables publish for a weak opening (#359)", async () => {
    const onPublish = vi.fn();
    const p = progress({ cover: "present", episodes: [ep({ file: "genesis.md", state: "ready", summary: "Ready to publish", cuts: READY_CUTS })] });
    // Has a title but a one-line synopsis body → readiness blockers.
    const auth = makeAuthFetch(p, { content: { content: "# The Awakening\n\nLogline: a cell wakes up." }, structure: { content: "# The Awakening\n" } });
    render(<CartoonPublishPage storyName="god-cell" authFetch={auth} onOpenFile={vi.fn()} onOpenStoryInfo={vi.fn()} onPublish={onPublish} genre="Science Fiction" language="Korean" />);

    const readiness = await screen.findByTestId("cartoon-genesis-readiness");
    expect(readiness).toHaveAttribute("data-blocked", "true");
    expect(screen.getAllByTestId("genesis-readiness-blocker").length).toBeGreaterThan(0);
    expect(screen.getByTestId("publish-cta")).toBeDisabled();
    fireEvent.click(screen.getByTestId("publish-cta"));
    expect(onPublish).not.toHaveBeenCalled();
  });

  // #461: the grouped publish-issues diagnostic (#360) moved here. A blocked plot
  // with malformed publish markdown surfaces grouped step headings.
  it("shows grouped publish issues for a blocked plot (#360)", async () => {
    const p = progress({
      cover: "present",
      episodes: [ep({ file: "plot-01.md", kind: "plot", label: "Episode 01", title: "The Heist", state: "blocked", summary: "issues", cuts: READY_CUTS })],
    });
    // A cut with an uploaded URL but a markdown block whose image ref doesn't
    // match → classifyCartoonReadiness → stage "error" with image-ref issues.
    const md = "# The Heist\n\n<!-- ows:cartoon-cut cut-001 start -->\n![](https://ipfs.filebase.io/ipfs/WRONG)\n<!-- ows:cartoon-cut cut-001 end -->\n";
    const cuts = { title: "The Heist", cuts: [{ id: "cut-001", uploadedUrl: "https://ipfs.filebase.io/ipfs/RIGHT", overlays: [], dialogue: [], finalImagePath: "f.webp", exportedAt: 1, cleanImagePath: "c.webp" }] };
    const auth = makeAuthFetch(p, { content: { content: md }, cuts });
    render(<CartoonPublishPage storyName="god-cell" authFetch={auth} onOpenFile={vi.fn()} onOpenStoryInfo={vi.fn()} onPublish={vi.fn()} />);

    expect(await screen.findByTestId("cartoon-publish-issues")).toBeInTheDocument();
    expect(screen.getByTestId("cartoon-issue-group-images")).toBeInTheDocument();
    expect(screen.getByTestId("cartoon-technical-details")).toBeInTheDocument();
  });
});
