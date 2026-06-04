import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CartoonPublishPage } from "./CartoonPublishPage";
import { installObjectUrlStub } from "./asset-test-utils";
import type { StoryProgress, EpisodeProgress } from "@app-lib/story-progress";

// #360: when a cartoon episode is publish-blocked in the "error" stage, the
// publish panel groups the readiness issues by workflow step (with a writer-facing
// heading) instead of listing a flat wall of repeated per-cut technical errors.
//
// #461: the grouped-issues card moved from the episode view to the Publish tab,
// so this renders CartoonPublishPage for the active plot episode.
beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

// A fully-lettered/uploaded cut whose marker block references a DIFFERENT url
// than its recorded uploadedUrl → a genuine (non-awaiting) image-reference error,
// so classifyCartoonReadiness resolves to the "error" stage.
const CONTENT = "<!-- ows:cartoon-cut cut-001 start -->\n![c](https://bad)\n<!-- ows:cartoon-cut cut-001 end -->";
function mismatchedCut() {
  return {
    id: 1, shotType: "wide", description: "d", characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: "assets/plot-01/cut-01-clean.webp", finalImagePath: "assets/plot-01/cut-01-final.webp",
    exportedAt: "2026-01-01", uploadedCid: "Qm", uploadedUrl: "https://good", overlays: [{ id: "1", type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }],
  };
}

const READY_CUTS = { total: 1, needClean: 1, withClean: 1, withText: 1, exported: 1, uploaded: 1 };

function ep(o: Partial<EpisodeProgress> & { file: string }): EpisodeProgress {
  return {
    file: o.file, label: o.label ?? "Episode 01", kind: o.kind ?? "plot", title: o.title ?? null,
    state: o.state ?? "blocked", summary: o.summary ?? "issues", published: o.published ?? false,
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

function makeFetch() {
  const p = progress([
    ep({ file: "genesis.md", kind: "genesis", label: "Episode 1 / Genesis", published: true, state: "published" }),
    ep({ file: "plot-01.md" }),
  ]);
  return vi.fn((url: string) => {
    if (url.endsWith("/progress")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(p) });
    if (url.endsWith("/structure.md")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: "" }) });
    if (url.includes("/cuts/")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ version: 1, plotFile: "plot-01", title: "The Couple Coupon", cuts: [mismatchedCut()] }) });
    if (url.endsWith("/plot-01.md")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: CONTENT }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("cartoon grouped publish-readiness messaging (#360)", () => {
  it("renders issues grouped by workflow step instead of a flat per-cut list", async () => {
    render(<CartoonPublishPage storyName="coupon-crush" authFetch={makeFetch()} onOpenFile={vi.fn()} onOpenStoryInfo={vi.fn()} onPublish={vi.fn()} genre="Adventure" language="English" />);

    const container = await screen.findByTestId("cartoon-publish-issues");
    expect(container).toHaveTextContent("Finish these workflow steps");
    // A grouped heading (workflow step), not a flat error dump.
    const group = await screen.findByTestId("cartoon-issue-group-images");
    expect(group).toBeInTheDocument();
    expect(group).toHaveTextContent("Fix image references");
    // The concise group heading does NOT inline the raw validator string…
    expect(group.textContent).not.toMatch(/does not match the recorded uploaded URL/);
    // …but the raw line is still available, collapsed, in the technical details (#421).
    const details = screen.getByTestId("cartoon-technical-details");
    expect(details).toHaveTextContent("Technical details");
    expect(details).toHaveTextContent(/does not match the recorded uploaded URL/);
  });
});
