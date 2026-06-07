// Story-level production progress model (#418).
//
// After creating a cartoon story the writer is dropped into files + terminal
// output with no product-level view of what's done and what's next. This builds
// a single workflow map — story metadata, setup, cover, and per-episode state —
// from already-available data (story meta, per-episode markdown + cuts, cover
// detection), reusing the cartoon readiness helpers so the overview agrees with
// the per-file publish UI. Pure + framework-free so it's unit-testable; the
// route reads the files and the panel just renders the result.

import type { Cut } from "./cuts";
import type { CartoonCoach } from "./cartoon-coach";
import {
  classifyCartoonReadiness,
  summarizeCutProgress,
  cartoonChecklist,
  type CartoonChecklistStep,
} from "./cartoon-readiness";

export type EpisodeState =
  | "placeholder"   // cartoon: no cuts planned yet (a future-episode stub)
  | "planning"      // cartoon: cut plan set, publish layout not built
  | "in-progress"   // cartoon: building images / awaiting uploads
  | "ready"         // ready to publish
  | "blocked"       // needs fixes
  | "draft"         // fiction: written, not published
  | "published";

export interface EpisodeProgress {
  /** File this episode maps to, e.g. "genesis.md" | "plot-01.md". */
  file: string;
  /** Reader-facing label: "Episode 1 / Genesis", "Episode 2", "Chapter 1". */
  label: string;
  kind: "genesis" | "plot";
  title: string | null;
  state: EpisodeState;
  /** One concise line — no raw validator text. */
  summary: string;
  published: boolean;
  /**
   * Cartoon cut progress; null for fiction. `needClean`/`withClean` count image
   * cuts only; `withText`, export, and upload count every cut including text panels.
   */
  cuts: { total: number; needClean: number; withClean: number; withText: number; exported: number; uploaded: number } | null;
  /**
   * Per-step production checklist (plan → clean → letter → export → upload →
   * publish) for the cartoon workflow map (#438), reusing the same `cartoonChecklist`
   * the per-file workflow guide uses so the progress page and the file view agree.
   * Null for fiction; an empty array for a not-started cartoon episode (no cuts
   * planned yet), which the map renders as a "not started" stub.
   */
  checklist: CartoonChecklistStep[] | null;
}

export interface StoryProgress {
  name: string;
  contentType: "fiction" | "cartoon";
  metadata: {
    title: string | null;
    language: string | null;
    genre: string | null;
    isNsfw: boolean | null;
    contentType: "fiction" | "cartoon";
  };
  setup: { hasStructure: boolean; hasGenesis: boolean };
  /** Cover state (meaningful for cartoon; fiction may ignore). */
  cover: "missing" | "present" | "invalid";
  episodes: EpisodeProgress[];
  summary: {
    episodes: number;
    published: number;
    readyToPublish: number;
    placeholders: number;
    blocked: number;
  };
  /** Single product-level next step in plain language, or null if all done. */
  nextAction: string | null;
  /** A copy-paste prompt the writer can hand to the agent for the next step
   * (#423), or null when the next step is a UI action (cover/publish) not an
   * agent task. */
  nextPrompt: string | null;
  /**
   * Persistent workflow coach (#429): the single next action derived from the
   * current state, typed as an agent prompt or an in-app UI action. Attached by
   * the route (it needs the focused file + on-disk asset hints); null for
   * fiction. Absent when not computed (e.g. the pure builder), so existing
   * consumers reading only nextAction/nextPrompt are unaffected.
   */
  coach?: CartoonCoach | null;
}

export interface EpisodeInput {
  /** "genesis.md" | "plot-01.md". */
  file: string;
  status: "published" | "published-not-indexed" | "pending" | "draft";
  /** Publish-facing markdown content. */
  markdown: string;
  /** Parsed cuts (cartoon); null when there's no cuts.json (fiction or none). */
  cuts: Cut[] | null;
  /** Episode title from cuts.json, if any. */
  title: string | null;
}

export interface StoryProgressInput {
  name: string;
  contentType: "fiction" | "cartoon";
  title: string | null;
  language?: string | null;
  genre?: string | null;
  isNsfw?: boolean | null;
  hasStructure: boolean;
  hasGenesis: boolean;
  cover: "missing" | "present" | "invalid";
  /** Ordered: genesis first, then plot-01, plot-02, … */
  episodes: EpisodeInput[];
}

function isPublished(status: EpisodeInput["status"]): boolean {
  return status === "published" || status === "published-not-indexed";
}

/** "Episode 2" for plot-01 (genesis is Episode 1), "Chapter 1" for fiction. */
function episodeLabel(file: string, kind: "genesis" | "plot", contentType: "fiction" | "cartoon"): string {
  if (kind === "genesis") return contentType === "cartoon" ? "Episode 1 / Genesis" : "Genesis";
  const n = parseInt(file.match(/^plot-(\d+)\.md$/)?.[1] ?? "0", 10);
  return contentType === "cartoon" ? `Episode ${n + 1}` : `Chapter ${n}`;
}

function cartoonEpisode(ep: EpisodeInput, contentType: "fiction" | "cartoon"): EpisodeProgress {
  const kind = ep.file === "genesis.md" ? "genesis" : "plot";
  const label = episodeLabel(ep.file, kind, contentType);
  const cuts = ep.cuts ?? [];
  const p = summarizeCutProgress(cuts);
  const published = isPublished(ep.status);
  const checklist = cartoonChecklist({ cuts, published }).steps;
  const base = { file: ep.file, label, kind, title: ep.title, published, checklist,
    cuts: { total: p.total, needClean: p.needClean, withClean: p.withClean, withText: p.withText, exported: p.exported, uploaded: p.uploaded } } as const;

  if (published) return { ...base, state: "published", summary: "Published to PlotLink" };

  const stage = classifyCartoonReadiness(ep.markdown, cuts).stage;
  switch (stage) {
    case "not-started":
      return { ...base, state: "placeholder", summary: "Not started — no cuts planned yet" };
    case "planning":
      return { ...base, state: "planning", summary: `Cut plan set (${p.total} cut${p.total === 1 ? "" : "s"}) — prepare for publish` };
    case "awaiting-upload":
      return { ...base, state: "in-progress", summary: `${p.uploaded} / ${p.total} cuts have uploaded images` };
    case "ready":
      return { ...base, state: "ready", summary: "Ready to publish" };
    case "error":
    default:
      return { ...base, state: "blocked", summary: "Needs fixes before publishing" };
  }
}

function fictionEpisode(ep: EpisodeInput): EpisodeProgress {
  const kind = ep.file === "genesis.md" ? "genesis" : "plot";
  const label = episodeLabel(ep.file, kind, "fiction");
  const published = isPublished(ep.status);
  return {
    file: ep.file, label, kind, title: ep.title, published, cuts: null, checklist: null,
    state: published ? "published" : "draft",
    summary: published ? "Published to PlotLink" : "Drafted — ready to review and publish",
  };
}

/**
 * Build the story-level progress map. Cartoon episodes reuse the readiness
 * classifier so a placeholder plot reads as "placeholder", never publish-ready;
 * fiction gets a simpler written/published view. `nextAction` is the single
 * plain-language step the writer should take next.
 */
export function buildStoryProgress(input: StoryProgressInput): StoryProgress {
  const cartoon = input.contentType === "cartoon";
  const episodes = input.episodes.map((ep) => (cartoon ? cartoonEpisode(ep, "cartoon") : fictionEpisode(ep)));

  const published = episodes.filter((e) => e.published).length;
  const readyToPublish = episodes.filter((e) => e.state === "ready").length;
  const placeholders = episodes.filter((e) => e.state === "placeholder").length;
  const blocked = episodes.filter((e) => e.state === "blocked").length;

  let nextAction: string | null;
  // A paste-ready agent prompt for the agent-driven stages; null for UI-only
  // steps (cover/publish). Worded for the writer to copy verbatim (#423).
  let nextPrompt: string | null = null;
  if (!input.hasStructure) {
    nextAction = "Ask the agent to write the story bible (structure.md).";
    nextPrompt = cartoon
      ? "Let's start this cartoon. Write the story bible (structure.md) — visual style, character bible, and episode format — then the Genesis (Episode 1) opening. Don't generate images, letter, upload, or publish yet."
      : "Let's start this story. Write the structure (outline, characters, arc), then the Genesis hook.";
  } else if (!input.hasGenesis) {
    nextAction = cartoon
      ? "Ask the agent to write the Genesis (Episode 1) opening."
      : "Ask the agent to write the Genesis (story hook).";
    nextPrompt = cartoon
      ? "Write the Genesis (Episode 1) opening for this cartoon, then plan its cuts in genesis.cuts.json. Don't generate images yet."
      : "Write the Genesis (story hook) for this story.";
  } else {
    const ready = episodes.find((e) => !e.published && e.state === "ready");
    const working = episodes.find((e) => !e.published && (e.state === "planning" || e.state === "in-progress"));
    const draft = episodes.find((e) => !e.published && e.state === "draft");
    const placeholder = episodes.find((e) => !e.published && e.state === "placeholder");
    // #462: a missing cover is a publish-readiness recommendation, not the
    // primary step. It leads only once the active episode's production is
    // complete (the `ready` case, or nothing pending) — never while an episode is
    // mid-production. So episode production leads over a missing cover.
    const coverMissing = cartoon && input.cover === "missing";
    if (ready) nextAction = coverMissing ? "Create or import a cover image for the story." : `Publish ${ready.label}.`;
    else if (working) nextAction = cartoon
      ? `Continue ${working.label}: ${working.summary.toLowerCase()}.`
      : `Review and publish ${working.label}.`;
    else if (draft) nextAction = `Review and publish ${draft.label}.`;
    else if (placeholder) {
      nextAction = `Plan the cuts for ${placeholder.label} to start it.`;
      nextPrompt = `Plan the cuts for ${placeholder.label} in its cuts.json. Don't generate images, letter, upload, or publish yet.`;
    } else if (coverMissing) nextAction = "Create or import a cover image for the story.";
    else if (episodes.length > 0 && published === episodes.length) nextAction = null; // all published
    else {
      nextAction = cartoon ? "Plan the next episode's cuts." : "Write the next chapter.";
      nextPrompt = cartoon ? "Plan the cuts for the next episode in a new cuts.json. Don't generate images yet." : "Write the next chapter.";
    }
  }

  return {
    name: input.name,
    contentType: input.contentType,
    metadata: {
      title: input.title,
      language: input.language ?? null,
      genre: input.genre ?? null,
      isNsfw: input.isNsfw ?? null,
      contentType: input.contentType,
    },
    setup: { hasStructure: input.hasStructure, hasGenesis: input.hasGenesis },
    cover: input.cover,
    episodes,
    summary: { episodes: episodes.length, published, readyToPublish, placeholders, blocked },
    nextAction,
    nextPrompt,
  };
}
