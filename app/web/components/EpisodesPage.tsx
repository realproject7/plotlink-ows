import { useEffect, useState } from "react";
import type { StoryProgress, EpisodeProgress } from "@app-lib/story-progress";

interface EpisodesPageProps {
  storyName: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  onOpenFile: (storyName: string, file: string) => void;
}

/**
 * "Episodes" workflow page for cartoon stories (#439, spec §2 nav target).
 *
 * A reader-ordered list of the story's episodes (Genesis = Episode 1, plot-NN =
 * Episode N+1) with status, so a normal creator manages episodes without the
 * file tree. Clicking one opens it in the preview. The dedicated rich episode
 * manager is a later ticket (§11); this is the workflow nav's episodes target.
 */
export function EpisodesPage({ storyName, authFetch, onOpenFile }: EpisodesPageProps) {
  const [episodes, setEpisodes] = useState<EpisodeProgress[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await authFetch(`/api/stories/${storyName}/progress`);
        const data: StoryProgress | null = res.ok ? await res.json() : null;
        if (!cancelled) {
          setEpisodes(Array.isArray(data?.episodes) ? data!.episodes : null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) { setEpisodes(null); setLoading(false); }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [storyName, authFetch]);

  if (loading) {
    return <div className="h-full flex items-center justify-center text-muted text-sm" data-testid="episodes-loading">Loading episodes…</div>;
  }
  if (!episodes) {
    return <div className="h-full flex items-center justify-center text-muted text-sm">Could not load episodes.</div>;
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4" data-testid="episodes-page">
      <h2 className="text-base font-serif text-foreground">Episodes</h2>
      <p className="mt-0.5 text-[11px] text-muted">Genesis is Episode 1; each plot file is the next episode.</p>

      {episodes.length === 0 ? (
        <p className="mt-4 text-xs text-muted italic" data-testid="episodes-empty">No episodes yet — write the Genesis to start Episode 1.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-1">
          {episodes.map((ep) => (
            <li key={ep.file}>
              <button
                onClick={() => onOpenFile(storyName, ep.file)}
                data-testid={`episodes-row-${ep.file}`}
                data-state={ep.state}
                className="w-full text-left flex items-start gap-2 rounded px-2 py-1.5 hover:bg-surface"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">{ep.label}</span>
                    {ep.title && <span className="text-[11px] text-muted truncate">· {ep.title}</span>}
                    <span className="ml-auto text-[10px] text-muted">{ep.file}</span>
                  </span>
                  <span className="block text-[11px] text-muted">{ep.summary}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
