import { describe, it, expect } from "vitest";
import { buildStoryProgress, type EpisodeInput, type StoryProgress } from "./story-progress";
import { deriveCartoonCoach } from "./cartoon-coach";
import type { Cut } from "./cuts";

// --- cut builders for each production stage -------------------------------
function cut(overrides: Partial<Cut> = {}): Cut {
  return {
    id: 1, shotType: "medium", description: "", characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null, exportedAt: null, uploadedCid: null, uploadedUrl: null,
    overlays: [], ...overrides,
  };
}
const planned = (id: number) => cut({ id }); // cut planned, no clean image
const cleaned = (id: number) => cut({ id, cleanImagePath: `c${id}.webp` }); // clean image, no overlays
const lettered = (id: number) => cut({ id, cleanImagePath: `c${id}.webp`, overlays: [{ id: `o${id}`, type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }] });
const exported = (id: number) => cut({ ...lettered(id), finalImagePath: `f${id}.webp`, exportedAt: "2026-01-01" });
const uploaded = (id: number, url: string) => cut({ ...exported(id), uploadedCid: `Qm${id}`, uploadedUrl: url });
const textPanel = (id: number) => cut({ id, kind: "text", background: "#111" });
const readyBlock = (id: number, url: string) => {
  const tag = `cut-${String(id).padStart(3, "0")}`;
  return `<!-- ows:cartoon-cut ${tag} start -->\n![c](${url})\n<!-- ows:cartoon-cut ${tag} end -->`;
};

const ep = (o: Partial<EpisodeInput> & { file: string }): EpisodeInput => ({ status: "pending", markdown: "", cuts: null, title: null, ...o });

function cartoon(episodes: EpisodeInput[], setup: { hasStructure?: boolean; hasGenesis?: boolean; cover?: "missing" | "present" | "invalid" } = {}): StoryProgress {
  return buildStoryProgress({
    name: "god-cell", contentType: "cartoon", title: "신의 세포", language: "Korean", genre: "Science Fiction",
    hasStructure: setup.hasStructure ?? true, hasGenesis: setup.hasGenesis ?? true, cover: setup.cover ?? "present",
    episodes,
  });
}

describe("deriveCartoonCoach (#429)", () => {
  it("returns null for fiction (fiction UX unchanged)", () => {
    const p = buildStoryProgress({ name: "n", contentType: "fiction", title: "T", hasStructure: true, hasGenesis: true, cover: "missing", episodes: [ep({ file: "genesis.md", status: "draft" })] });
    expect(deriveCartoonCoach(p)).toBeNull();
  });

  it("setup: no structure ⇒ write the story bible (agent prompt)", () => {
    const c = deriveCartoonCoach(cartoon([], { hasStructure: false, hasGenesis: false }))!;
    expect(c.actionKind).toBe("agent");
    expect(c.action).toMatch(/story bible/i);
    expect(c.prompt).toMatch(/structure\.md/);
    expect(c.uiAction).toBeNull();
  });

  it("setup: structure but no genesis ⇒ write the Genesis (agent prompt)", () => {
    const c = deriveCartoonCoach(cartoon([], { hasGenesis: false }))!;
    expect(c.action).toMatch(/Genesis/);
    expect(c.episodeFile).toBe("genesis.md");
    expect(c.actionKind).toBe("agent");
  });

  it("setup gates take priority over a missing cover (matches buildStoryProgress order)", () => {
    // cover missing must not stop the coach from advancing the episode pipeline.
    const c = deriveCartoonCoach(cartoon([ep({ file: "genesis.md", cuts: [] })], { cover: "missing" }))!;
    expect(c.action).toMatch(/Plan the Genesis cuts/i);
  });

  it("placeholder genesis (no cuts) ⇒ Plan the Genesis cuts", () => {
    const c = deriveCartoonCoach(cartoon([ep({ file: "genesis.md", cuts: [] })]))!;
    expect(c.action).toBe("Plan the Genesis cuts");
    expect(c.actionKind).toBe("agent");
    expect(c.episodeFile).toBe("genesis.md");
  });

  it("placeholder future episode (focused) ⇒ 'Plan this episode first', never a publish warning (acceptance #3)", () => {
    const p = cartoon([
      ep({ file: "genesis.md", markdown: readyBlock(1, "https://x/1"), cuts: [uploaded(1, "https://x/1")], status: "published" }),
      ep({ file: "plot-01.md", markdown: "# Episode 2\n\nPlaceholder.", cuts: [] }),
    ]);
    const c = deriveCartoonCoach(p, { focusFile: "plot-01.md" })!;
    expect(c.action).toBe("Plan this episode first");
    expect(c.stageLabel).toMatch(/not started/i);
    expect(c.episodeFile).toBe("plot-01.md");
  });

  it("cuts planned, no clean images ⇒ Generate clean images (agent)", () => {
    const c = deriveCartoonCoach(cartoon([ep({ file: "genesis.md", cuts: [planned(1), planned(2)] })]))!;
    expect(c.action).toBe("Generate clean images");
    expect(c.actionKind).toBe("agent");
    expect(c.prompt).toMatch(/genesis\.cuts\.json/);
  });

  it("clean images on disk but not recorded ⇒ Refresh assets (read-only UI) (acceptance #2)", () => {
    const c = deriveCartoonCoach(cartoon([ep({ file: "plot-01.md", cuts: [planned(1), planned(2)] })]), { undetectedCleanByFile: { "plot-01.md": 2 } })!;
    expect(c.actionKind).toBe("ui");
    expect(c.uiAction).toBe("refresh-assets");
    expect(c.action).toMatch(/refresh/i);
  });

  it("clean images recorded ⇒ Review cuts and start lettering (UI)", () => {
    const c = deriveCartoonCoach(cartoon([ep({ file: "plot-01.md", cuts: [cleaned(1), cleaned(2)] })]))!;
    expect(c.uiAction).toBe("open-lettering");
    expect(c.action).toMatch(/lettering/i);
    expect(c.stageLabel).toBe("Clean images ready");
  });

  it("lettered but not exported ⇒ Finish and export the final images (UI)", () => {
    const c = deriveCartoonCoach(cartoon([ep({ file: "plot-01.md", cuts: [lettered(1)] })]))!;
    expect(c.uiAction).toBe("open-lettering");
    expect(c.action).toMatch(/export/i);
  });

  it("exported but not uploaded ⇒ Upload the final images (UI)", () => {
    const c = deriveCartoonCoach(cartoon([ep({ file: "plot-01.md", cuts: [exported(1)] })]))!;
    expect(c.uiAction).toBe("upload");
    expect(c.action).toMatch(/upload/i);
  });

  it("uploaded but publish layout not built ⇒ Prepare the episode for publish (UI), no jargon", () => {
    // uploaded cut + markdown with NO cut block ⇒ classifyCartoonReadiness "planning".
    const c = deriveCartoonCoach(cartoon([ep({ file: "plot-01.md", markdown: "# Episode 2", cuts: [uploaded(1, "https://x/1")] })]))!;
    expect(c.uiAction).toBe("generate-markdown");
    expect(c.action).toBe("Prepare the episode for publish");
    expect(c.action).not.toMatch(/markdown|generate md/i); // user-facing verbs only (acceptance #4)
  });

  it("fully ready ⇒ Publish to PlotLink (UI)", () => {
    const c = deriveCartoonCoach(cartoon([ep({ file: "plot-01.md", markdown: readyBlock(1, "https://x/1"), cuts: [uploaded(1, "https://x/1")] })]), { focusFile: "plot-01.md" })!;
    expect(c.uiAction).toBe("publish");
    expect(c.action).toMatch(/Publish .* to PlotLink/);
    expect(c.stageLabel).toBe("Ready to publish");
  });

  it("text panels never gate the clean/letter stage (#350)", () => {
    // One bare text panel: needClean === 0, so the coach skips the clean and
    // lettering stages and goes straight to exporting the panel's final image.
    const c = deriveCartoonCoach(cartoon([ep({ file: "plot-01.md", cuts: [textPanel(1)] })]))!;
    expect(c.uiAction).toBe("open-lettering");
    expect(c.action).toMatch(/export/i);
  });

  it("focus on an unfinished episode overrides the story's active episode", () => {
    const p = cartoon([
      ep({ file: "genesis.md", cuts: [planned(1)] }), // active = genesis (generate clean)
      ep({ file: "plot-01.md", cuts: [cleaned(1)] }), // focused plot = lettering
    ]);
    expect(deriveCartoonCoach(p)!.episodeFile).toBe("genesis.md"); // no focus ⇒ active
    expect(deriveCartoonCoach(p, { focusFile: "plot-01.md" })!.uiAction).toBe("open-lettering");
  });

  it("non-episode focus (structure.md) falls back to the active episode", () => {
    const p = cartoon([ep({ file: "genesis.md", cuts: [planned(1)] })]);
    const c = deriveCartoonCoach(p, { focusFile: "structure.md" })!;
    expect(c.episodeFile).toBe("genesis.md");
  });

  it("every episode published ⇒ Start the next episode (agent)", () => {
    const p = cartoon([ep({ file: "genesis.md", status: "published", markdown: readyBlock(1, "https://x/1"), cuts: [uploaded(1, "https://x/1")] })]);
    const c = deriveCartoonCoach(p)!;
    expect(c.action).toMatch(/next episode/i);
    expect(c.actionKind).toBe("agent");
  });
});
