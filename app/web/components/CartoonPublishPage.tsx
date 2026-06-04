import { useEffect, useState } from "react";
import type { StoryProgress, EpisodeProgress } from "@app-lib/story-progress";

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

type CheckState = "done" | "todo";
interface PublishCheck { label: string; status: CheckState; detail?: string | null }

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

  const c = active.cuts;
  const coverDone = progress.cover === "present";
  const checks: PublishCheck[] = [
    { label: "Opening text ready", status: "done" }, // the episode exists once it appears here
    { label: "Cut plan", status: c && c.total > 0 ? "done" : "todo", detail: c ? `${c.total} cut${c.total === 1 ? "" : "s"} planned` : "not started" },
    { label: "Clean images converted", status: c && c.needClean > 0 && c.withClean === c.needClean ? "done" : "todo", detail: c ? `${c.withClean} / ${c.needClean}` : null },
    { label: "Cuts lettered", status: c && c.needClean > 0 && c.withText === c.needClean ? "done" : "todo", detail: c ? `${c.withText} / ${c.needClean}` : null },
    { label: "Final images exported", status: c && c.total > 0 && c.exported === c.total ? "done" : "todo", detail: c ? `${c.exported} / ${c.total}` : null },
    { label: "Final images uploaded", status: c && c.total > 0 && c.uploaded === c.total ? "done" : "todo", detail: c ? `${c.uploaded} / ${c.total}` : null },
    { label: "Cover image", status: coverDone ? "done" : "todo", detail: coverDone ? null : "recommended before publishing" },
    { label: "Publish to PlotLink", status: active.published ? "done" : "todo" },
  ];

  const ready = active.state === "ready";
  const blocked = active.state === "blocked";
  // Genesis publishes via createStoryline and needs genre+language (set in Story
  // Info); plots inherit the storyline, so they don't.
  const isGenesisActive = active.file === "genesis.md";
  const metaReady = !isGenesisActive || (!!genre && !!language);
  const isPublishing = !!publishingFile && publishingFile === active.file;
  const canPublish = ready && metaReady && !isPublishing && !!onPublish;

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
      <p className="mt-0.5 text-[11px] text-muted">Finalize this episode: convert, letter, export, upload, then publish to PlotLink.</p>

      <ul className="mt-3 flex flex-col gap-1.5 max-w-xl" data-testid="publish-checklist">
        {checks.map((ck, i) => (
          <li key={i} className="flex items-baseline gap-2 text-xs" data-testid="publish-check" data-status={ck.status}>
            <span className={`flex-shrink-0 ${ck.status === "done" ? "text-green-700" : "text-muted"}`} aria-hidden>{ck.status === "done" ? "✓" : "○"}</span>
            <span className={ck.status === "done" ? "text-foreground" : "text-muted"}>{ck.label}</span>
            {ck.detail && <span className="text-muted">· {ck.detail}</span>}
          </li>
        ))}
      </ul>

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
