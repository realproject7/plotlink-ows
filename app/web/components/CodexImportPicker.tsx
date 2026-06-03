import { useEffect, useMemo, useState } from "react";
import { listCodexCacheImages, fetchCodexCacheFile, type CodexCacheImage } from "../lib/codex-import";

type AuthFetch = (url: string, opts?: RequestInit) => Promise<Response>;

/**
 * Codex generated-image cache picker (#403, visual selection + filtering #409).
 *
 * Lists the recent images in Codex's generated-image cache (newest first) and
 * lets the writer import one straight into the current cut — so a Codex-generated
 * PNG no longer requires hunting through a hidden `~/.codex/generated_images`
 * folder in an OS file dialog. Picking an image fetches its bytes as a File and
 * hands it to `onImport`, which runs the SAME in-browser PNG→WebP conversion +
 * upload-clean path as a manually-selected file, so the asset constraints and
 * upload validation are unchanged.
 *
 * #409: the cache can hold a long run of near-identical `ig_<hash>.png` names, so
 * the picker is built for *visual* selection — a large thumbnail leads each row,
 * the noisy hash filename is demoted to a hover title, and the readable metadata
 * (how recently it was generated + its size) is what the writer reads. A filter
 * box narrows a long list by filename. The list stays read-only until the writer
 * explicitly clicks Import.
 *
 * Read-only and best-effort: a missing/empty cache (e.g. Codex not installed)
 * simply shows an empty state with no error, since this is an optional shortcut
 * over the still-present manual "Upload clean image" button.
 */

/** Load an auth-protected URL as a blob object URL for an <img> thumbnail. */
function useAuthedObjectUrl(url: string, authFetch: AuthFetch): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(url);
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setObjectUrl(revoked);
      } catch {
        /* best-effort thumbnail; the row still imports without it */
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [url, authFetch]);
  return objectUrl;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Human "how long ago" label for a cache image's mtime (#409). Pure and
 * now-injectable so it's deterministic in tests. The cache lists newest-first, so
 * this is the writer's main cue for "which one did I just generate".
 */
export function formatRelativeTime(mtimeMs: number, nowMs: number): string {
  const diff = nowMs - mtimeMs;
  if (!Number.isFinite(diff) || diff < 45_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(diff / (7 * 86_400_000));
  return `${weeks}w ago`;
}

function CodexThumb({ image, authFetch }: { image: CodexCacheImage; authFetch: AuthFetch }) {
  const url = useAuthedObjectUrl(`/api/codex/images/${encodeURIComponent(image.token)}`, authFetch);
  if (!url) {
    return <div className="w-16 h-16 flex-shrink-0 rounded border border-border bg-surface" />;
  }
  return (
    <img
      src={url}
      alt={image.name}
      className="w-16 h-16 flex-shrink-0 rounded border border-border object-cover bg-white"
    />
  );
}

export function CodexImportPicker({
  authFetch,
  cutId,
  onImport,
  onClose,
}: {
  authFetch: AuthFetch;
  cutId: number;
  /** Receives the fetched cache file; runs the shared PNG→WebP import + upload. */
  onImport: (file: File) => Promise<void>;
  onClose: () => void;
}) {
  const [images, setImages] = useState<CodexCacheImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importingToken, setImportingToken] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await listCodexCacheImages(authFetch);
      if (!cancelled) setImages(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!images) return [];
    if (!trimmedQuery) return images;
    return images.filter((img) => img.name.toLowerCase().includes(trimmedQuery));
  }, [images, trimmedQuery]);

  // One timestamp per render so all rows share the same "x ago" reference point.
  const now = Date.now();

  const handlePick = async (image: CodexCacheImage) => {
    setError(null);
    setImportingToken(image.token);
    try {
      const file = await fetchCodexCacheFile(authFetch, image);
      await onImport(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import the generated image");
    } finally {
      setImportingToken(null);
    }
  };

  const hasImages = images !== null && images.length > 0;

  return (
    <div
      className="rounded border border-border bg-surface/60 p-2 space-y-2"
      data-testid={`codex-picker-${cutId}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-foreground">Import a Codex-generated image</p>
        <button
          onClick={onClose}
          data-testid={`codex-picker-close-${cutId}`}
          className="text-[11px] text-muted hover:text-foreground"
        >
          Close
        </button>
      </div>

      {hasImages && (
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by file name…"
            data-testid={`codex-picker-search-${cutId}`}
            className="min-w-0 flex-1 px-2 py-1 text-[11px] border border-border rounded bg-transparent focus:border-accent focus:outline-none"
          />
          <span className="text-[10px] text-muted whitespace-nowrap" data-testid={`codex-picker-count-${cutId}`}>
            {trimmedQuery ? `${filtered.length} of ${images!.length}` : `${images!.length} image${images!.length === 1 ? "" : "s"}`}
          </span>
        </div>
      )}

      {images === null && (
        <p className="text-[11px] text-muted" data-testid={`codex-picker-loading-${cutId}`}>
          Looking for generated images…
        </p>
      )}

      {images !== null && images.length === 0 && (
        <p className="text-[11px] text-muted" data-testid={`codex-picker-empty-${cutId}`}>
          No generated images found in the Codex cache yet. Generate art in Codex, then reopen this
          list — or use &ldquo;Upload clean image&rdquo; to pick a file.
        </p>
      )}

      {hasImages && filtered.length === 0 && (
        <p className="text-[11px] text-muted" data-testid={`codex-picker-no-match-${cutId}`}>
          No generated images match &ldquo;{query.trim()}&rdquo;.
        </p>
      )}

      {hasImages && filtered.length > 0 && (
        <ul className="space-y-1 max-h-72 overflow-y-auto">
          {filtered.map((img) => (
            <li
              key={img.token}
              data-testid={`codex-image-${img.token}`}
              className="flex items-center gap-2 rounded border border-border bg-background/40 p-1.5"
            >
              <CodexThumb image={img} authFetch={authFetch} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-foreground">
                  {formatRelativeTime(img.mtimeMs, now)} · {formatSize(img.size)}
                </p>
                <p className="truncate text-[10px] font-mono text-muted" title={img.name}>
                  {img.name}
                </p>
              </div>
              <button
                onClick={() => handlePick(img)}
                disabled={importingToken !== null}
                data-testid={`codex-import-${img.token}`}
                className="px-2 py-1 text-[11px] border border-accent/30 text-accent rounded hover:bg-accent/5 disabled:opacity-50"
              >
                {importingToken === img.token ? "Importing…" : "Import to this cut"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-[11px] text-error">{error}</p>}
    </div>
  );
}
