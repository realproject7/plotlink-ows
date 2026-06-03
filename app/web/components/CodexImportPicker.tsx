import { useEffect, useState } from "react";
import { listCodexCacheImages, fetchCodexCacheFile, type CodexCacheImage } from "../lib/codex-import";

type AuthFetch = (url: string, opts?: RequestInit) => Promise<Response>;

/**
 * Codex generated-image cache picker (#403).
 *
 * Lists the recent images in Codex's generated-image cache (newest first) and
 * lets the writer import one straight into the current cut — so a Codex-generated
 * PNG no longer requires hunting through a hidden `~/.codex/generated_images`
 * folder in an OS file dialog. Picking an image fetches its bytes as a File and
 * hands it to `onImport`, which runs the SAME in-browser PNG→WebP conversion +
 * upload-clean path as a manually-selected file, so the asset constraints and
 * upload validation are unchanged.
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

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function CodexThumb({ image, authFetch }: { image: CodexCacheImage; authFetch: AuthFetch }) {
  const url = useAuthedObjectUrl(`/api/codex/images/${encodeURIComponent(image.token)}`, authFetch);
  if (!url) {
    return <div className="w-12 h-12 flex-shrink-0 rounded border border-border bg-surface" />;
  }
  return (
    <img
      src={url}
      alt={image.name}
      className="w-12 h-12 flex-shrink-0 rounded border border-border object-cover bg-white"
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

      {images === null && (
        <p className="text-[11px] text-muted" data-testid={`codex-picker-loading-${cutId}`}>
          Looking for generated images…
        </p>
      )}

      {images !== null && images.length === 0 && (
        <p className="text-[11px] text-muted" data-testid={`codex-picker-empty-${cutId}`}>
          No generated images found in the Codex cache yet. Generate art in the Codex terminal, then
          reopen this list — or use &ldquo;Upload clean image&rdquo; to pick a file.
        </p>
      )}

      {images !== null && images.length > 0 && (
        <ul className="space-y-1 max-h-64 overflow-y-auto">
          {images.map((img) => (
            <li
              key={img.token}
              data-testid={`codex-image-${img.token}`}
              className="flex items-center gap-2 rounded border border-border bg-background/40 p-1.5"
            >
              <CodexThumb image={img} authFetch={authFetch} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-mono text-foreground" title={img.name}>
                  {img.name}
                </p>
                <p className="text-[10px] text-muted">{formatSize(img.size)}</p>
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
