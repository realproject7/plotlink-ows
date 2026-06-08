import { useEffect, useState } from "react";
import type { StoryProgress, EpisodeProgress } from "@app-lib/story-progress";
import { cartoonChecklist, cartoonGenesisReadiness, classifyCartoonReadiness, groupCartoonIssues } from "@app-lib/cartoon-readiness";
import type { Cut } from "@app-lib/cuts";
import { CartoonProductionStatus } from "./CartoonProductionStatus";
import { derivePublishTitle, isRawFilenameTitle, hasExplicitEpisodeTitle } from "../lib/publish-helpers";

interface CartoonPublishPageProps {
  storyName: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  /** Open the episode's cut workspace to finish production (letter / export / upload). */
  onOpenFile: (storyName: string, file: string) => void;
  /** Switch to the Story Info page (to add a missing cover / set genre+language). */
  onOpenStoryInfo: () => void;
  /** Trigger the on-chain publish for the active episode (same flow the episode used
   *  to host). The page loads the imported cover for Genesis and hands it through. */
  onPublish?: (storyName: string, file: string, genre: string, language: string, isNsfw: boolean, coverFile?: File | null) => void | Promise<boolean | void>;
  /** The file currently mid-publish (disables the button + shows progress). */
  publishingFile?: string | null;
  /** Story metadata from Story Info — Genesis can't publish without genre+language. */
  genre?: string;
  language?: string;
  isNsfw?: boolean;
  refreshKey?: number;
}

/**
 * Dedicated cartoon "Publish" workflow page (#449, spec §10).
 *
 * The Publish nav tab opens THIS page (the nav stays on Publish) instead of
 * visually routing to the Genesis file view. It consolidates the finalization
 * prerequisites for the active episode — opening text, cut plan, converted clean
 * images, lettering, exported + uploaded finals, cover, and the on-chain publish
 * — into one readiness summary, then launches the existing publish/finish
 * controls in the episode (so the cover handling, preflight, and SSE publish flow
 * are unchanged). Raw validator lines stay collapsed under technical details.
 *
 * Cartoon-only: mounted from the cartoon workflow nav, so fiction publish is
 * untouched.
 */
export function CartoonPublishPage({ storyName, authFetch, onOpenFile, onOpenStoryInfo, onPublish, publishingFile, genre, language, isNsfw, refreshKey = 0 }: CartoonPublishPageProps) {
  const [progress, setProgress] = useState<StoryProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  // Diagnostics inputs for the active episode (#461): the migrated publish-title,
  // genesis-readiness, and grouped-issues panels that used to live in the episode
  // view. The episode's markdown content + cut plan + (genesis) structure.md drive
  // the same pure helpers PreviewPanel used, so the diagnostics read identically.
  const [activeContent, setActiveContent] = useState<string | null>(null);
  const [activeCuts, setActiveCuts] = useState<Cut[] | null>(null);
  const [activeEpisodeTitle, setActiveEpisodeTitle] = useState<string | null>(null);
  const [structureContent, setStructureContent] = useState<string | null>(null);

  // Load the imported Genesis cover (assets/cover.webp) as a File so the publish
  // flow attaches it on createStoryline — the same auto-detect the episode used to
  // run. Best-effort: a missing/invalid cover just publishes without one (#461).
  const loadCoverFile = async (): Promise<File | null> => {
    try {
      const res = await authFetch(`/api/stories/${storyName}/cover-asset`);
      const data = res.ok ? await res.json() : null;
      if (!data?.found || !data.valid || !data.path) return null;
      const assetRes = await authFetch(`/api/stories/${storyName}/asset/${String(data.path).replace(/^assets\//, "")}`);
      if (!assetRes.ok) return null;
      const blob = await assetRes.blob();
      return new File([blob], String(data.path).split("/").pop() || "cover.webp", { type: data.type || blob.type });
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await authFetch(`/api/stories/${storyName}/progress`);
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (!data || !Array.isArray(data.episodes)) { setLoadError(true); setProgress(null); }
        else setProgress(data);
        setLoading(false);
      } catch {
        if (!cancelled) { setLoadError(true); setProgress(null); setLoading(false); }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [storyName, authFetch, refreshKey]);

  // The active episode file to diagnose: first unpublished (Genesis first).
  const activeFile = progress?.episodes?.find((e) => !e.published)?.file ?? null;
  const activeIsGenesis = activeFile === "genesis.md";

  // Reset the per-episode diagnostics state DURING RENDER whenever the active
  // episode (or refresh) changes, so a stale episode's content/cuts/structure
  // never leak beside another and the publish gate doesn't read prior data while
  // the new fetch is in flight (#461). Reset-during-render (via a loaded-key
  // useState, mirroring WorkflowCoach) avoids the setState-in-effect cascade the
  // ESLint rule flags. The effect below only performs the async fetch + assigns.
  const diagKey = JSON.stringify([activeFile ?? "", refreshKey]);
  const [loadedDiagKey, setLoadedDiagKey] = useState<string | null>(null);
  if (loadedDiagKey !== diagKey) {
    setLoadedDiagKey(diagKey);
    setActiveContent(null);
    setActiveCuts(null);
    setActiveEpisodeTitle(null);
    setStructureContent(null);
  }

  // Fetch the active episode's markdown + cut plan (+ structure.md for Genesis)
  // so the migrated diagnostics can recompute with the same helpers PreviewPanel
  // used (#461). Best-effort: missing cuts (404) ⇒ null.
  useEffect(() => {
    if (!activeFile) return;
    let cancelled = false;
    const plotKey = activeFile.replace(/\.md$/, "");
    (async () => {
      try {
        const reqs: Promise<Response>[] = [
          authFetch(`/api/stories/${storyName}/${activeFile}`),
          authFetch(`/api/stories/${storyName}/cuts/${plotKey}`),
        ];
        if (activeIsGenesis) reqs.push(authFetch(`/api/stories/${storyName}/structure.md`));
        const [fileRes, cutsRes, structRes] = await Promise.all(reqs);
        if (cancelled) return;
        setActiveContent(fileRes.ok ? (await fileRes.json()).content ?? "" : "");
        if (cutsRes.ok) {
          const cutsData = await cutsRes.json();
          if (cancelled) return;
          setActiveCuts(Array.isArray(cutsData.cuts) ? cutsData.cuts : []);
          setActiveEpisodeTitle(typeof cutsData.title === "string" ? cutsData.title : null);
        } else {
          setActiveCuts(null);
          setActiveEpisodeTitle(null);
        }
        if (activeIsGenesis && structRes) {
          setStructureContent(structRes.ok ? (await structRes.json())?.content ?? null : null);
        } else {
          setStructureContent(null);
        }
      } catch {
        if (!cancelled) { setActiveContent(""); setActiveCuts(null); setActiveEpisodeTitle(null); setStructureContent(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [activeFile, activeIsGenesis, storyName, authFetch, refreshKey]);

  if (loading) {
    return <div className="h-full flex items-center justify-center text-muted text-sm" data-testid="publish-page-loading">Loading publish readiness…</div>;
  }
  if (loadError || !progress) {
    return <div className="h-full flex items-center justify-center text-muted text-sm">Could not load publish readiness.</div>;
  }

  // The active episode to finalize: the first unpublished one (Genesis first).
  const active: EpisodeProgress | undefined = progress.episodes.find((e) => !e.published);

  if (!active) {
    return (
      <div className="h-full overflow-y-auto px-4 py-4" data-testid="cartoon-publish-page">
        <h2 className="text-base font-serif text-foreground">Publish</h2>
        <p className="mt-2 text-xs text-green-700" data-testid="publish-all-done">
          {progress.episodes.length > 0
            ? "All episodes are published to PlotLink. Plan the next episode to continue."
            : "No episodes yet — write the Genesis (Episode 1) to begin."}
        </p>
      </div>
    );
  }

  const coverDone = progress.cover === "present";
  const checklist = cartoonChecklist({ cuts: activeCuts ?? [], published: active.published });

  const ready = active.state === "ready";
  const blocked = active.state === "blocked";
  // Genesis publishes via createStoryline and needs genre+language (set in Story
  // Info); plots inherit the storyline, so they don't.
  const isGenesisActive = active.file === "genesis.md";
  const metaReady = !isGenesisActive || (!!genre && !!language);
  const isPublishing = !!publishingFile && publishingFile === active.file;

  // ── Migrated episode diagnostics (#461) ──────────────────────────────────
  // The same pure helpers PreviewPanel used, now driven by the active episode's
  // fetched markdown/cuts/structure. Computed only once the content is loaded so
  // a still-loading panel doesn't flash a false "raw title" block.
  const diagLoaded = activeContent !== null;
  // #358: the exact public title this episode will publish with, plus its block
  // states (raw filename, or — for plots — only a generic "Episode NN" fallback).
  const resolvedPublishTitle = diagLoaded
    ? derivePublishTitle({
        fileName: active.file,
        fileContent: activeContent ?? "",
        storySlug: storyName,
        structureContent,
        contentType: "cartoon",
        episodeTitle: activeEpisodeTitle,
      })
    : null;
  const rawTitleBlocked = !!resolvedPublishTitle && isRawFilenameTitle(resolvedPublishTitle, active.file);
  const episodeTitleMissing = !isGenesisActive && diagLoaded
    && !hasExplicitEpisodeTitle({ fileContent: activeContent ?? "", episodeTitle: activeEpisodeTitle });
  const titleBlocked = rawTitleBlocked || episodeTitleMissing;
  // #359: cartoon Genesis prologue readiness (blockers disable publish).
  const genesisReadiness = isGenesisActive && diagLoaded ? cartoonGenesisReadiness(activeContent ?? "") : null;
  const genesisBlocked = !!genesisReadiness && genesisReadiness.blockers.length > 0;
  // #360: grouped publish-readiness issues for a blocked plot (shown only when
  // there are issues).
  const readinessReport = !isGenesisActive && diagLoaded && activeCuts !== null
    ? classifyCartoonReadiness(activeContent ?? "", activeCuts)
    : null;
  const cartoonIssues = readinessReport && readinessReport.stage === "error" ? readinessReport.issues : [];

  // The diagnostics also gate publish (mirror PreviewPanel's titleBlocked /
  // genesisBlocked), so a raw title / weak Genesis can't publish from here either.
  // Require the diagnostics to have LOADED first (#461, re1): until the episode
  // content (+ cut plan for plots) is fetched, titleBlocked/genesisBlocked are
  // both false, so a ready episode with metadata could otherwise publish in the
  // load window before the raw-title / weak-Genesis checks have run.
  const diagReady = diagLoaded && (isGenesisActive || activeCuts !== null);
  const canPublish = ready && metaReady && diagReady && !titleBlocked && !genesisBlocked && !isPublishing && !!onPublish;

  const handlePublish = async () => {
    if (!canPublish || !onPublish) return;
    setPublishError(null);
    try {
      const cover = isGenesisActive ? await loadCoverFile() : null;
      await onPublish(storyName, active.file, genre ?? "", language ?? "", !!isNsfw, cover);
    } catch {
      setPublishError("Publish could not be started. Please try again.");
    }
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-4" data-testid="cartoon-publish-page">
      <h2 className="text-base font-serif text-foreground">Publish {active.label}</h2>
      <p className="mt-0.5 text-[11px] text-muted">Publish stays focused on readiness and blockers. Open production details only if you need the full step map.</p>

      <div className="mt-3 max-w-xl" data-testid="publish-checklist">
        <CartoonProductionStatus
          checklist={checklist}
          markdownReady={ready}
          published={active.published}
          title="Episode production"
          subtitle={coverDone
            ? "Cover and publish readiness are checked below."
            : "Episode production is tracked here; cover readiness is checked below."}
          rootTestId="publish-production-status"
          detailsTestId="publish-production-details"
          stepTestIdPrefix="publish-step"
        />
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          <span
            className={`rounded-full border px-2 py-0.5 ${coverDone ? "border-green-700/30 bg-green-700/10 text-green-700" : "border-border bg-background text-muted"}`}
            data-testid="publish-cover-status"
          >
            Cover image: {coverDone ? "Ready" : "Missing"}
          </span>
          {isGenesisActive && (
            <span
              className={`rounded-full border px-2 py-0.5 ${metaReady ? "border-green-700/30 bg-green-700/10 text-green-700" : "border-border bg-background text-muted"}`}
              data-testid="publish-metadata-status"
            >
              Story info: {metaReady ? "Ready" : "Set genre & language"}
            </span>
          )}
        </div>
      </div>

      {/* Migrated episode diagnostics (#461): the publish title (#358), Genesis
          prologue readiness (#359), and grouped publish issues (#360) that used
          to render in the episode action bar — same helpers, same data-testids. */}
      {resolvedPublishTitle && (
        <div
          className="mt-4 flex flex-col gap-0.5 max-w-xl"
          data-testid="publish-title-preview"
          data-raw={rawTitleBlocked ? "true" : "false"}
          data-blocked={titleBlocked ? "true" : "false"}
        >
          <span className="text-[11px] text-foreground">
            <span className="font-medium">{isGenesisActive ? "Story title" : "Episode title"}:</span>{" "}
            <span className={titleBlocked ? "text-error font-medium" : "text-foreground"}>{resolvedPublishTitle}</span>
          </span>
          {rawTitleBlocked ? (
            <span className="text-[10px] text-error" data-testid="publish-title-raw-error">
              This would publish as a raw filename. {isGenesisActive
                ? "Add a real “# Title” heading to genesis.md"
                : "Set a title in the cut plan (or add a “# Title” to the episode)"} before publishing.
            </span>
          ) : episodeTitleMissing ? (
            <span className="text-[10px] text-error" data-testid="publish-title-episode-required">
              “{resolvedPublishTitle}” is a generic placeholder, not a reader-facing title, so it can’t be published. Set a real episode title in the cut plan (or add a “# Title” to the episode) — e.g. “Episode 01 — The Couple Coupon” — before publishing.
            </span>
          ) : null}
        </div>
      )}

      {genesisReadiness && (
        <div
          className="mt-4 flex flex-col gap-1 rounded border border-border bg-surface/50 p-2 max-w-xl"
          data-testid="cartoon-genesis-readiness"
          data-blocked={genesisBlocked ? "true" : "false"}
        >
          <span className="text-[11px] font-medium text-foreground">Story opening (Prologue)</span>
          <span className="text-[10px] text-muted" data-testid="genesis-readiness-hint">
            Genesis is the first thing readers see. Write it as the story opening/prologue, not a synopsis — set up the premise and stakes, then bridge into Episode 01.
          </span>
          {genesisReadiness.blockers.map((b, i) => (
            <span key={`b-${i}`} className="text-[10px] text-error" data-testid="genesis-readiness-blocker">{b}</span>
          ))}
          {genesisReadiness.warnings.map((w, i) => (
            <span key={`w-${i}`} className="text-[10px] text-amber-600" data-testid="genesis-readiness-warning">{w}</span>
          ))}
        </div>
      )}

      {cartoonIssues.length > 0 && (
        <div
          className="mt-4 flex flex-col gap-2 rounded-xl border border-error/30 bg-error/5 px-3 py-3 max-w-xl"
          data-testid="cartoon-publish-issues"
        >
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-error px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white">Before publish</span>
            <span className="text-xs font-medium text-foreground">Finish these workflow steps</span>
          </div>
          {groupCartoonIssues(cartoonIssues).map((g) => (
            <div
              key={g.key}
              className="rounded-lg border border-error/15 bg-background/70 px-2.5 py-2"
              data-testid={`cartoon-issue-group-${g.key}`}
            >
              <span className="text-[11px] font-medium text-foreground">{g.title}</span>
            </div>
          ))}
          <details className="text-[10px] text-muted" data-testid="cartoon-technical-details">
            <summary className="cursor-pointer select-none">Technical details</summary>
            <ul className="mt-1 ml-3 list-disc">
              {cartoonIssues.map((issue, i) => (
                <li key={i} className="font-mono break-words">{issue}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 max-w-xl">
        {!coverDone && (
          <button
            onClick={onOpenStoryInfo}
            data-testid="publish-add-cover"
            className="self-start rounded border border-border px-3 py-1.5 text-xs text-foreground hover:border-accent hover:text-accent transition-colors"
          >
            Add a cover image (Story Info)
          </button>
        )}
        {isGenesisActive && !metaReady && (
          <button
            onClick={onOpenStoryInfo}
            data-testid="publish-set-metadata"
            className="self-start rounded border border-border px-3 py-1.5 text-xs text-foreground hover:border-accent hover:text-accent transition-colors"
          >
            Set genre &amp; language (Story Info)
          </button>
        )}
        {!ready && (
          <button
            onClick={() => onOpenFile(storyName, active.file)}
            data-testid="publish-open-episode"
            className="self-start rounded border border-accent/40 px-3 py-1.5 text-xs text-accent hover:bg-accent/5 transition-colors"
          >
            Open {active.label} to finish {blocked ? "and fix issues" : "(letter / export / upload)"}
          </button>
        )}
        <button
          onClick={handlePublish}
          disabled={!canPublish}
          data-testid="publish-cta"
          className="self-start rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-dim disabled:opacity-50 transition-colors"
          title={canPublish ? undefined : "Finish the remaining steps above first"}
        >
          {isPublishing ? "Publishing…" : `Publish ${active.label} to PlotLink`}
        </button>
        {!ready ? (
          <p className="text-[11px] text-muted" data-testid="publish-blocked-reason">
            {blocked
              ? `Not publishable yet — ${active.summary.toLowerCase()}. Open the episode to fix the flagged cuts.`
              : `Not ready yet — ${active.summary.toLowerCase()}.`}
          </p>
        ) : !metaReady ? (
          <p className="text-[11px] text-amber-700" data-testid="publish-needs-metadata">
            Set the genre and language in Story Info before publishing.
          </p>
        ) : titleBlocked || genesisBlocked ? (
          <p className="text-[11px] text-error" data-testid="publish-title-blocked-reason">
            {genesisBlocked
              ? "Fix the Story opening issues above before publishing."
              : "Set a real reader-facing title above before publishing."}
          </p>
        ) : null}
        {publishError && (
          <p className="text-[11px] text-error" data-testid="publish-error">{publishError}</p>
        )}
      </div>

      <details className="mt-4 max-w-xl" data-testid="publish-technical-details">
        <summary className="text-[11px] text-muted cursor-pointer hover:text-foreground">Technical validation details</summary>
        <div className="mt-1 text-[10px] text-muted space-y-0.5">
          <p>Episode file: <span className="font-mono">{active.file}</span></p>
          <p>State: {active.state} — {active.summary}</p>
          <p>Per-cut production (cut plan, clean images, lettering, export, upload) happens in the episode’s cut workspace; open it above to finish any remaining step.</p>
        </div>
      </details>
    </div>
  );
}
