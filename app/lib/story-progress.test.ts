import { describe, it, expect } from "vitest";
import { buildStoryProgress, type EpisodeInput } from "./story-progress";
import type { Cut } from "./cuts";

function cut(overrides: Partial<Cut> = {}): Cut {
  return {
    id: 1, shotType: "medium", description: "", characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null, exportedAt: null, uploadedCid: null, uploadedUrl: null,
    overlays: [], ...overrides,
  };
}

/** A fully uploaded cut whose marker block references its uploaded URL ⇒ ready. */
function uploadedCut(id: number, url: string): Cut {
  return cut({ id, cleanImagePath: `c${id}.webp`, finalImagePath: `f${id}.webp`, exportedAt: "2026-01-01",
    uploadedCid: `Qm${id}`, uploadedUrl: url, overlays: [{ id: `o${id}`, type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }] });
}
function readyBlock(id: number, url: string): string {
  const tag = `cut-${String(id).padStart(3, "0")}`;
  return `<!-- ows:cartoon-cut ${tag} start -->\n![c](${url})\n<!-- ows:cartoon-cut ${tag} end -->`;
}

const ep = (o: Partial<EpisodeInput> & { file: string }): EpisodeInput => ({
  status: "pending", markdown: "", cuts: null, title: null, ...o,
});

describe("buildStoryProgress (#418)", () => {
  it("cartoon: an empty-cuts placeholder plot is 'placeholder' / Not started, never ready", () => {
    const p = buildStoryProgress({
      name: "god-cell", contentType: "cartoon", title: "신의 세포", language: "Korean", genre: "Science Fiction",
      hasStructure: true, hasGenesis: true, cover: "present",
      episodes: [
        ep({ file: "genesis.md", status: "pending", markdown: readyBlock(1, "https://x/1"), cuts: [uploadedCut(1, "https://x/1")] }),
        ep({ file: "plot-01.md", status: "pending", markdown: "# Episode 2\n\nPlaceholder.", cuts: [] }),
      ],
    });
    const plot = p.episodes.find((e) => e.file === "plot-01.md")!;
    expect(plot.state).toBe("placeholder");
    expect(plot.label).toBe("Episode 2"); // plot-01 is Episode 2 (genesis is Episode 1)
    expect(plot.summary).toMatch(/not started/i);
    expect(p.summary.placeholders).toBe(1);

    const genesis = p.episodes.find((e) => e.file === "genesis.md")!;
    expect(genesis.label).toBe("Episode 1 / Genesis");
    expect(genesis.state).toBe("ready");
    expect(p.summary.readyToPublish).toBe(1);
  });

  it("cartoon: a published episode is 'published' and counts toward published", () => {
    const p = buildStoryProgress({
      name: "s", contentType: "cartoon", title: "S", hasStructure: true, hasGenesis: true, cover: "present",
      episodes: [ep({ file: "genesis.md", status: "published", markdown: readyBlock(1, "https://x/1"), cuts: [uploadedCut(1, "https://x/1")] })],
    });
    expect(p.episodes[0].state).toBe("published");
    expect(p.summary.published).toBe(1);
  });

  it("cartoon next action: missing structure → bible; then genesis; then cover; then publish the ready episode", () => {
    const noStruct = buildStoryProgress({ name: "s", contentType: "cartoon", title: null, hasStructure: false, hasGenesis: false, cover: "missing", episodes: [] });
    expect(noStruct.nextAction).toMatch(/story bible/i);

    const noGenesis = buildStoryProgress({ name: "s", contentType: "cartoon", title: null, hasStructure: true, hasGenesis: false, cover: "missing", episodes: [] });
    expect(noGenesis.nextAction).toMatch(/Genesis \(Episode 1\)/i);

    const noCover = buildStoryProgress({ name: "s", contentType: "cartoon", title: "S", hasStructure: true, hasGenesis: true, cover: "missing",
      episodes: [ep({ file: "genesis.md", status: "pending", markdown: readyBlock(1, "https://x/1"), cuts: [uploadedCut(1, "https://x/1")] })] });
    expect(noCover.nextAction).toMatch(/cover image/i);

    const readyToPublish = buildStoryProgress({ name: "s", contentType: "cartoon", title: "S", hasStructure: true, hasGenesis: true, cover: "present",
      episodes: [ep({ file: "genesis.md", status: "pending", markdown: readyBlock(1, "https://x/1"), cuts: [uploadedCut(1, "https://x/1")] })] });
    expect(readyToPublish.nextAction).toMatch(/Publish Episode 1 \/ Genesis/);
  });

  it("fiction: simpler draft/published view, Chapter labels, no cuts, no cover gate", () => {
    const p = buildStoryProgress({
      name: "novel", contentType: "fiction", title: "A Novel", language: "English", genre: "Fantasy",
      hasStructure: true, hasGenesis: true, cover: "missing",
      episodes: [
        ep({ file: "genesis.md", status: "published", markdown: "Hook." }),
        ep({ file: "plot-01.md", status: "pending", markdown: "Chapter one." }),
      ],
    });
    expect(p.episodes[0].state).toBe("published");
    expect(p.episodes[0].label).toBe("Genesis");
    expect(p.episodes[1].state).toBe("draft");
    expect(p.episodes[1].label).toBe("Chapter 1");
    expect(p.episodes[1].cuts).toBeNull();
    // Fiction never demands a cover — next action is about the unpublished chapter.
    expect(p.nextAction).not.toMatch(/cover/i);
    expect(p.nextAction).toMatch(/Chapter 1/);
  });

  it("provides a copy-paste nextPrompt for the agent stages (#423)", () => {
    // Brand-new cartoon (no structure) → a setup prompt the writer can paste.
    const fresh = buildStoryProgress({ name: "s", contentType: "cartoon", title: "신의 세포", language: "Korean", hasStructure: false, hasGenesis: false, cover: "missing", episodes: [] });
    expect(fresh.nextPrompt).toMatch(/Write the story bible/i);
    expect(fresh.nextPrompt).toMatch(/Don't generate images/i);

    // A UI-only next step (cover) has no agent prompt.
    const coverNext = buildStoryProgress({ name: "s", contentType: "cartoon", title: "S", hasStructure: true, hasGenesis: true, cover: "missing",
      episodes: [ep({ file: "genesis.md", status: "pending", markdown: readyBlock(1, "https://x/1"), cuts: [uploadedCut(1, "https://x/1")] })] });
    expect(coverNext.nextAction).toMatch(/cover/i);
    expect(coverNext.nextPrompt).toBeNull();
  });

  it("all published ⇒ nextAction is null", () => {
    const p = buildStoryProgress({
      name: "s", contentType: "fiction", title: "S", hasStructure: true, hasGenesis: true, cover: "missing",
      episodes: [ep({ file: "genesis.md", status: "published", markdown: "x" })],
    });
    expect(p.nextAction).toBeNull();
  });
});
