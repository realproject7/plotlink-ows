import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CartoonPublishPage } from "./CartoonPublishPage";
import { installObjectUrlStub } from "./asset-test-utils";
import type { StoryProgress, EpisodeProgress } from "@app-lib/story-progress";

// #358: the publish panel must show the resolved PUBLIC title before publish for
// cartoon genesis (Story title) and cartoon plots (Episode title), and block raw
// filename labels ("genesis"/"plot-NN").
//
// #461: the publish-title preview moved from the episode view to the Publish tab,
// so these tests now render CartoonPublishPage for the active episode (genesis or
// plot-01) and assert the same data-testids there.
beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const SKELETON_MD = "<!-- ows:cartoon-cut cut-001 start -->\n<!-- Cut 1: awaiting upload -->\n<!-- ows:cartoon-cut cut-001 end -->";

function imageCut() {
  return {
    id: 1, shotType: "wide", description: "d", characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: "assets/plot-01/cut-01-clean.webp", finalImagePath: null, exportedAt: null,
    uploadedCid: null, uploadedUrl: null, overlays: [],
  };
}

const READY_CUTS = { total: 1, needClean: 1, withClean: 1, withText: 1, exported: 1, uploaded: 1 };

function ep(o: Partial<EpisodeProgress> & { file: string }): EpisodeProgress {
  return {
    file: o.file, label: o.label ?? (o.file === "genesis.md" ? "Episode 1 / Genesis" : "Episode 01"),
    kind: o.kind ?? (o.file === "genesis.md" ? "genesis" : "plot"), title: o.title ?? null,
    state: o.state ?? "ready", summary: o.summary ?? "Ready to publish", published: o.published ?? false,
    checklist: o.checklist ?? null, cuts: o.cuts ?? READY_CUTS,
  };
}

function progress(episodes: EpisodeProgress[]): StoryProgress {
  return {
    name: "coupon-crush", contentType: "cartoon",
    metadata: { title: "Coupon Crush", language: "English", genre: "Adventure", isNsfw: false, contentType: "cartoon" },
    setup: { hasStructure: true, hasGenesis: true }, cover: "present",
    episodes,
    summary: { episodes: episodes.length, published: 0, readyToPublish: 0, placeholders: 0, blocked: 0 },
    nextAction: null, nextPrompt: null,
  };
}

// fileName drives which fixtures matter; opts let each test set genesis/structure
// content and the cuts title. The active episode is genesis.md unless a plot is
// requested (then genesis is marked published so plot-01 is active).
function makeFetch(fileName: string, opts: { genesis?: string; structure?: string; cutsTitle?: string | null; plot?: string }) {
  const episodes = fileName === "genesis.md"
    ? [ep({ file: "genesis.md" })]
    : [ep({ file: "genesis.md", published: true, state: "published" }), ep({ file: "plot-01.md" })];
  const p = progress(episodes);
  return vi.fn((url: string) => {
    if (url.endsWith("/progress")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(p) });
    if (url.endsWith("/structure.md")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: opts.structure ?? "" }) });
    if (url.includes("/cuts/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "plot-01", ...(opts.cutsTitle !== undefined && opts.cutsTitle !== null ? { title: opts.cutsTitle } : {}), cuts: [imageCut()] }) });
    }
    if (url.endsWith("/genesis.md")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: opts.genesis ?? "" }) });
    if (url.endsWith("/plot-01.md")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: opts.plot ?? SKELETON_MD }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

function renderPanel(_fileName: string, authFetch: ReturnType<typeof makeFetch>) {
  render(
    <CartoonPublishPage storyName="coupon-crush" authFetch={authFetch} onOpenFile={vi.fn()} onOpenStoryInfo={vi.fn()} onPublish={vi.fn()} genre="Adventure" language="English" />,
  );
}

describe("cartoon publish title preview (#358)", () => {
  it("shows the resolved Story title for a headingless cartoon genesis (from structure.md)", async () => {
    renderPanel("genesis.md", makeFetch("genesis.md", { genesis: "A cold opening hook with no heading.", structure: "# Coupon Crush at Closing Time\n\n## Visual Style" }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveTextContent("Story title:");
    expect(t).toHaveTextContent("Coupon Crush at Closing Time");
    expect(t).toHaveAttribute("data-raw", "false");
  });

  it("blocks publish when the resolved genesis title is still raw 'genesis'", async () => {
    renderPanel("genesis.md", makeFetch("genesis.md", { genesis: "# genesis\n\nhook", structure: "" }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveAttribute("data-raw", "true");
    expect(screen.getByTestId("publish-title-raw-error")).toBeInTheDocument();
    expect(screen.getByTestId("publish-cta")).toBeDisabled();
  });

  it("shows the cut-plan Episode title for a cartoon plot and does not block on the title (#365)", async () => {
    renderPanel("plot-01.md", makeFetch("plot-01.md", { cutsTitle: "The Couple Coupon" }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveTextContent("Episode title:");
    expect(t).toHaveTextContent("The Couple Coupon");
    expect(t).toHaveAttribute("data-raw", "false");
    expect(t).toHaveAttribute("data-blocked", "false");
    expect(screen.queryByTestId("publish-title-episode-required")).not.toBeInTheDocument();
  });

  it("a real H1 in the plot markdown satisfies the explicit-title requirement even with no cut-plan title (#365)", async () => {
    renderPanel("plot-01.md", makeFetch("plot-01.md", { cutsTitle: null, plot: "# The Couple Coupon\n\n" + SKELETON_MD }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveTextContent("The Couple Coupon");
    expect(t).toHaveAttribute("data-blocked", "false");
    expect(screen.queryByTestId("publish-title-episode-required")).not.toBeInTheDocument();
  });

  it("a legacy cartoon plot with no cuts title shows 'Episode 01' (never 'plot-01') as a diagnostic but blocks publish (#365)", async () => {
    renderPanel("plot-01.md", makeFetch("plot-01.md", { cutsTitle: null }));
    const t = await screen.findByTestId("publish-title-preview");
    // The "Episode 01" fallback is shown as a diagnostic of what the title WOULD
    // be, but it is no longer publishable (#365) — never the raw 'plot-01'.
    expect(t).toHaveTextContent("Episode 01");
    expect(t.textContent).not.toMatch(/plot-01/);
    expect(t).toHaveAttribute("data-raw", "false");
    expect(t).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("publish-title-episode-required")).toBeInTheDocument();
    expect(screen.getByTestId("publish-cta")).toBeDisabled();
  });

  it("blocks publish when the cut-plan title is a generic 'Episode 01' label (#368)", async () => {
    renderPanel("plot-01.md", makeFetch("plot-01.md", { cutsTitle: "Episode 01" }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveTextContent("Episode 01");
    expect(t).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("publish-title-episode-required")).toBeInTheDocument();
    expect(screen.getByTestId("publish-cta")).toBeDisabled();
  });

  it("blocks publish when the plot H1 is a generic '# Episode 01' label (#368)", async () => {
    renderPanel("plot-01.md", makeFetch("plot-01.md", { cutsTitle: null, plot: "# Episode 01\n\n" + SKELETON_MD }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("publish-title-episode-required")).toBeInTheDocument();
    expect(screen.getByTestId("publish-cta")).toBeDisabled();
  });

  it("allows a number paired with real title text — 'Episode 01 — The Couple Coupon' (#368)", async () => {
    renderPanel("plot-01.md", makeFetch("plot-01.md", { cutsTitle: "Episode 01 — The Couple Coupon" }));
    const t = await screen.findByTestId("publish-title-preview");
    expect(t).toHaveTextContent("Episode 01 — The Couple Coupon");
    expect(t).toHaveAttribute("data-blocked", "false");
    expect(screen.queryByTestId("publish-title-episode-required")).not.toBeInTheDocument();
  });

  // Precedence: the plot H1 wins in derivePublishTitle, so a generic H1 must
  // block even when a real cut-plan title is also set — the generic H1 is what
  // would actually publish (#368, @re1 finding).
  it("blocks a generic '# Episode 01' H1 even when the cut-plan title is real (#368)", async () => {
    renderPanel("plot-01.md", makeFetch("plot-01.md", { cutsTitle: "The Couple Coupon", plot: "# Episode 01\n\n" + SKELETON_MD }));
    const t = await screen.findByTestId("publish-title-preview");
    // The H1 ("Episode 01") is what derivePublishTitle resolves, so it shows + blocks.
    expect(t).toHaveTextContent("Episode 01");
    expect(t).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("publish-title-episode-required")).toBeInTheDocument();
    expect(screen.getByTestId("publish-cta")).toBeDisabled();
  });
});
