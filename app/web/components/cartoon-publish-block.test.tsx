import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CartoonPublishPage } from "./CartoonPublishPage";
import type { StoryProgress, EpisodeProgress } from "@app-lib/story-progress";

// #461: cartoon publish blocking moved from the episode action bar to the Publish
// tab. The grouped publish-issues card (#360) renders here for the "error" stage;
// the calm awaiting-upload / planning states no longer surface a red issues card
// (those are conveyed by the checklist + blocked reason). Publish is gated by the
// episode's progress state plus the migrated title/genesis diagnostics.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

const READY_CUTS = { total: 1, needClean: 1, withClean: 1, withText: 1, exported: 1, uploaded: 1 };

function ep(o: Partial<EpisodeProgress> & { file: string }): EpisodeProgress {
  return {
    file: o.file, label: o.label ?? "Episode 01", kind: o.kind ?? "plot", title: o.title ?? null,
    state: o.state ?? "blocked", summary: o.summary ?? "issues", published: o.published ?? false,
    checklist: o.checklist ?? null, cuts: o.cuts ?? READY_CUTS,
  };
}

function progress(active: EpisodeProgress): StoryProgress {
  const episodes = [ep({ file: "genesis.md", kind: "genesis", label: "Episode 1 / Genesis", published: true, state: "published" }), active];
  return {
    name: "story", contentType: "cartoon",
    metadata: { title: "Story", language: "English", genre: "Adventure", isNsfw: false, contentType: "cartoon" },
    setup: { hasStructure: true, hasGenesis: true }, cover: "present",
    episodes,
    summary: { episodes: episodes.length, published: 1, readyToPublish: 0, placeholders: 0, blocked: 0 },
    nextAction: null, nextPrompt: null,
  };
}

// authFetch router: serves /progress, the active plot's content + cuts.json.
function makeAuthFetch(opts: { state: EpisodeProgress["state"]; content: string; cuts: unknown; cutsOk?: boolean }) {
  const p = progress(ep({ file: "plot-01.md", state: opts.state }));
  return vi.fn().mockImplementation((url: string) => {
    if (url.endsWith("/progress")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(p) });
    if (url.endsWith("/structure.md")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: "" }) });
    if (url.includes("/cuts/")) {
      return Promise.resolve({ ok: opts.cutsOk !== false, status: opts.cutsOk === false ? 400 : 200, json: () => Promise.resolve(opts.cuts) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: opts.content }) });
  });
}

function renderPublish(authFetch: ReturnType<typeof makeAuthFetch>) {
  render(<CartoonPublishPage storyName="story" authFetch={authFetch} onOpenFile={vi.fn()} onOpenStoryInfo={vi.fn()} onPublish={vi.fn()} genre="Adventure" language="English" />);
}

const uploadedCut = {
  id: 1, shotType: "wide", description: "Scene", characters: [],
  dialogue: [], narration: "", sfx: "",
  cleanImagePath: "assets/plot-01/cut-01-clean.webp",
  finalImagePath: "assets/plot-01/cut-01-final.webp",
  exportedAt: "2026-01-01", uploadedCid: "Qm", uploadedUrl: "https://ipfs/Qm",
  overlays: [],
};

describe("cartoon publish blocking on the Publish tab (#461)", () => {
  it("does NOT show the red issues card for an awaiting-upload skeleton, and publish stays disabled", async () => {
    // Block exists for every cut, but the cut has no uploaded image yet → the
    // calm awaiting-upload (non-error) stage, so no red issues card.
    const awaitingCut = { ...uploadedCut, finalImagePath: null, exportedAt: null, uploadedCid: null, uploadedUrl: null };
    const md = "<!-- ows:cartoon-cut cut-001 start -->\n<!-- Cut 1: awaiting upload -->\n<!-- ows:cartoon-cut cut-001 end -->";
    const authFetch = makeAuthFetch({ state: "in-progress", content: md, cuts: { version: 1, plotFile: "plot-01", cuts: [awaitingCut] } });

    renderPublish(authFetch);

    await screen.findByTestId("publish-cta");
    expect(screen.queryByTestId("cartoon-publish-issues")).not.toBeInTheDocument();
    expect(screen.getByTestId("publish-cta")).toBeDisabled();
  });

  it("keeps publish disabled when the cuts file is invalid/missing", async () => {
    const authFetch = makeAuthFetch({ state: "blocked", content: "anything", cuts: { error: "invalid" }, cutsOk: false });

    renderPublish(authFetch);

    await screen.findByTestId("publish-cta");
    expect(screen.getByTestId("publish-cta")).toBeDisabled();
    expect(screen.getByTestId("publish-blocked-reason")).toBeInTheDocument();
  });

  it("no publish issues when cartoon markdown is fully ready", async () => {
    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![Scene](https://ipfs/Qm)\n<!-- ows:cartoon-cut cut-001 end -->";
    const authFetch = makeAuthFetch({ state: "ready", content: md, cuts: { version: 1, plotFile: "plot-01", cuts: [uploadedCut] } });

    renderPublish(authFetch);

    await screen.findByTestId("publish-cta");
    await waitFor(() => expect(screen.queryByTestId("cartoon-publish-issues")).not.toBeInTheDocument());
  });

  it("shows a publish-blocking re-export issue for stale tailed exports (#389)", async () => {
    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![Scene](https://ipfs/Qm)\n<!-- ows:cartoon-cut cut-001 end -->";
    const staleUploadedCut = {
      ...uploadedCut,
      overlays: [{ id: "ov1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "Hi", tailAnchor: { x: 0.5, y: 1.2 } }],
      finalRendererVersion: undefined,
    };
    const authFetch = makeAuthFetch({ state: "blocked", content: md, cuts: { version: 1, plotFile: "plot-01", cuts: [staleUploadedCut] } });

    renderPublish(authFetch);

    await waitFor(() => {
      expect(screen.getByTestId("cartoon-publish-issues")).toBeInTheDocument();
    });
    // The export step is surfaced as a concise grouped heading, and the raw
    // re-export validator string is available in the collapsible technical
    // details (#421).
    expect(screen.getByTestId("cartoon-issue-group-export")).toBeInTheDocument();
    expect(screen.getByTestId("cartoon-technical-details")).toHaveTextContent(/re-export required before publish/i);
    expect(screen.getByTestId("publish-cta")).toBeDisabled();
  });
});
