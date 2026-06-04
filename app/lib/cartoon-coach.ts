// Persistent cartoon workflow coach (#429).
//
// The cartoon production flow is long and non-obvious — create story → bible →
// Genesis → plan cuts → clean images → letter → export → upload → prepare →
// publish → verify. Each individual screen was improved across #418–#427, but a
// normal writer still needs ONE persistent, front-end guide that converts the
// current story/episode state into a single clear next action, without reading
// terminal logs or technical warnings.
//
// This derives that coach PURELY from the already-built `StoryProgress` (which
// the route assembles from .story.json, structure.md, genesis.md, the cuts.json
// files, local assets, exports, uploaded URLs and publish status), plus a small
// per-episode disk hint (clean images present on disk but not yet recorded). It
// returns one stage label + one primary action, typed as either an agent
// copy-paste prompt or a direct in-app UI action. Fiction returns null so the
// fiction UX is completely untouched.

import type { StoryProgress, EpisodeProgress } from "./story-progress";

/** A direct, app-driven next step the UI can perform/route to. */
export type CoachUiAction =
  | "open-cuts" // reveal the cut workspace
  | "open-lettering" // open the cut workspace to letter / export
  | "refresh-assets" // re-scan local clean images (#427)
  | "upload" // upload the final images
  | "generate-markdown" // "Prepare the episode for publish"
  | "publish" // publish the episode to PlotLink
  | "view-progress"; // open the story progress overview (#418)

export type CoachActionKind = "agent" | "ui";

export interface CartoonCoach {
  /** Short current-stage label, e.g. "Clean images ready". */
  stageLabel: string;
  /** One primary next action in user-facing verbs, e.g. "Review cuts and start lettering". */
  action: string;
  actionKind: CoachActionKind;
  /** Copy-paste agent prompt when `actionKind === "agent"`; null for UI actions. */
  prompt: string | null;
  /** The in-app action key when `actionKind === "ui"`; null for agent actions. */
  uiAction: CoachUiAction | null;
  /** Episode this action concerns (so the overview can deep-link), or null for setup-level steps. */
  episodeFile: string | null;
}

export interface CoachOptions {
  /**
   * Currently-viewed file (e.g. "plot-02.md"). When it names an unfinished
   * cartoon episode the coach speaks about THAT episode, so a future-episode
   * placeholder reads as "Plan this episode first" instead of pointing at the
   * story's active episode. Ignored for non-episode files (structure.md) and
   * already-published episodes — those fall back to the story's active episode.
   */
  focusFile?: string | null;
  /**
   * Per-episode count of clean images present on disk but NOT yet recorded in
   * cuts.json (acceptance #2). When > 0 at the clean-image stage the coach
   * surfaces "Refresh assets" (re-detect) instead of "Generate clean images".
   */
  undetectedCleanByFile?: Record<string, number>;
}

function agent(stageLabel: string, action: string, prompt: string, episodeFile: string | null): CartoonCoach {
  return { stageLabel, action, actionKind: "agent", prompt, uiAction: null, episodeFile };
}

function ui(stageLabel: string, action: string, uiAction: CoachUiAction, episodeFile: string | null): CartoonCoach {
  return { stageLabel, action, actionKind: "ui", prompt: null, uiAction, episodeFile };
}

/** "genesis.cuts.json" | "plot-01.cuts.json" — the cut plan a writer points the agent at. */
function cutsFileName(episodeFile: string): string {
  return episodeFile === "genesis.md" ? "genesis.cuts.json" : episodeFile.replace(/\.md$/, ".cuts.json");
}

/**
 * Convert the story/episode state into the single next action a cartoon writer
 * should take. Returns null for fiction (so fiction UX is unchanged) and for a
 * cartoon story that is already fully published with nothing queued.
 */
export function deriveCartoonCoach(progress: StoryProgress, opts: CoachOptions = {}): CartoonCoach | null {
  if (progress.contentType !== "cartoon") return null;

  // Setup gates block the whole story, so they take priority over any episode —
  // regardless of which file is in focus. These mirror buildStoryProgress's
  // setup ordering so the coach never disagrees with the progress overview.
  if (!progress.setup.hasStructure) {
    return agent(
      "New cartoon story",
      "Write the story bible",
      "Let's build this cartoon. Write the story bible (structure.md) — visual style, character bible, and episode format. Don't generate images, letter, upload, or publish yet.",
      "structure.md",
    );
  }
  if (!progress.setup.hasGenesis) {
    return agent(
      "Story bible ready",
      "Write the Genesis (Episode 1) opening",
      "Write the Genesis (Episode 1) opening for this cartoon, then plan its cuts in genesis.cuts.json. Don't generate images yet.",
      "genesis.md",
    );
  }

  // The episode the coach speaks about: the focused file when it's an unfinished
  // episode, otherwise the story's active (first unpublished) episode.
  const episodes = progress.episodes;
  const focused = opts.focusFile ? episodes.find((e) => e.file === opts.focusFile) : undefined;
  const active = episodes.find((e) => !e.published);
  const ep = focused && !focused.published ? focused : active;

  if (!ep) {
    // Every episode is published — nudge toward the next one rather than a wall
    // of "all done".
    return agent(
      "All episodes published",
      "Start the next episode",
      "Plan the cuts for the next episode in a new cuts.json. Don't generate images yet.",
      null,
    );
  }

  return coachForEpisode(ep, opts.undetectedCleanByFile?.[ep.file] ?? 0);
}

/**
 * The per-episode production pipeline, in the order a writer performs it
 * (#429): plan cuts → clean images → letter → export → upload → prepare →
 * publish. Each stage emits one stage label + one primary action; the
 * pre-image steps are agent prompts, the rest are in-app UI actions.
 */
function coachForEpisode(ep: EpisodeProgress, undetectedClean: number): CartoonCoach {
  const c = ep.cuts;
  const label = ep.label;
  const file = ep.file;
  const isGenesis = ep.kind === "genesis";

  // No cut plan yet — a not-started episode or a future-episode placeholder.
  // Acceptance #3: this reads as "plan this first", never a publish warning.
  if (!c || c.total === 0) {
    return agent(
      `${label} not started`,
      isGenesis ? "Plan the Genesis cuts" : "Plan this episode first",
      isGenesis
        ? "Plan the cuts for the Genesis (Episode 1) in genesis.cuts.json. Don't generate images, letter, upload, or publish yet."
        : `Plan the cuts for ${label} in ${cutsFileName(file)}. Don't generate images, letter, upload, or publish yet.`,
      file,
    );
  }

  // 1) Clean images — agent-generated. If images are already on disk but not yet
  //    recorded, the next action is a read-only re-scan instead (#427), not a
  //    redundant "generate again".
  if (c.withClean < c.needClean) {
    if (undetectedClean > 0) {
      return ui(
        "Clean images found on disk",
        "Refresh assets to detect them",
        "refresh-assets",
        file,
      );
    }
    return agent(
      `${label} cuts planned`,
      "Generate clean images",
      `Generate clean images for every cut in ${cutsFileName(file)}. Don't letter, upload, or publish yet.`,
      file,
    );
  }

  // 2) Lettering — place speech bubbles & captions in the cut workspace.
  if (c.withText < c.needClean) {
    return ui("Clean images ready", "Review cuts and start lettering", "open-lettering", file);
  }

  // 3) Export the lettered final images.
  if (c.exported < c.total) {
    return ui("Lettering in progress", "Finish and export the final images", "open-lettering", file);
  }

  // 4) Upload the exported final images.
  if (c.uploaded < c.total) {
    return ui("Final images ready", "Upload the final images", "upload", file);
  }

  // 5) Every cut is uploaded — assemble the publish layout, then publish. Driven
  //    by the same readiness state the per-file publish UI uses, so the coach and
  //    the publish controls never disagree.
  switch (ep.state) {
    case "ready":
      return ui("Ready to publish", `Publish ${label} to PlotLink`, "publish", file);
    case "blocked":
      return ui("Needs fixes before publishing", "Review and fix the publish issues", "open-cuts", file);
    case "planning":
    default:
      // Images uploaded but the publish layout (cut blocks) isn't built yet.
      return ui("Images uploaded", "Prepare the episode for publish", "generate-markdown", file);
  }
}
