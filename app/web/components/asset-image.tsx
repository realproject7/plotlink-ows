import { useState, useEffect } from "react";

type AuthFetch = (url: string, opts?: RequestInit) => Promise<Response>;

/** Resolve a story-relative asset path to its auth-protected API URL. */
export function assetUrl(storyName: string, assetPath: string): string {
  const relative = assetPath.startsWith("assets/") ? assetPath.slice(7) : assetPath;
  return `/api/stories/${storyName}/asset/${relative}`;
}

interface AssetState {
  /** Same-origin blob object URL safe to use as an <img src>, or null. */
  url: string | null;
  loading: boolean;
  error: boolean;
}

/**
 * Load an auth-protected story asset as a blob object URL.
 *
 * Story asset routes sit behind `requireAuth`, but a browser `<img src>`
 * request never carries the `Authorization: Bearer` header that `authFetch`
 * adds, so the raw URL 401s and the image breaks. Instead we fetch the asset
 * via `authFetch`, turn the response into a blob, and hand back an object URL.
 * The object URL is revoked when the asset path changes or the component
 * unmounts so we don't leak blobs across cut selections.
 */
export function useAuthedAsset(
  storyName: string,
  assetPath: string | null | undefined,
  authFetch: AuthFetch,
): AssetState {
  const [state, setState] = useState<AssetState>({
    url: null,
    loading: !!assetPath,
    error: false,
  });

  useEffect(() => {
    if (!assetPath) {
      setState({ url: null, loading: false, error: false });
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ url: null, loading: true, error: false });

    (async () => {
      try {
        const res = await authFetch(assetUrl(storyName, assetPath));
        if (!res.ok) throw new Error(`asset request failed (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, loading: false, error: false });
      } catch {
        if (!cancelled) setState({ url: null, loading: false, error: true });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storyName, assetPath, authFetch]);

  return state;
}

interface AssetImageProps {
  storyName: string;
  assetPath: string;
  authFetch: AuthFetch;
  alt: string;
  className?: string;
}

/**
 * Render an auth-protected story asset as an image, loading it through
 * `useAuthedAsset`. Shows a neutral placeholder while loading and a clear
 * "Image not available" state on failure so a broken auth boundary surfaces
 * instead of a broken-image glyph.
 */
export function AssetImage({ storyName, assetPath, authFetch, alt, className }: AssetImageProps) {
  const { url, loading, error } = useAuthedAsset(storyName, assetPath, authFetch);

  if (error || (!loading && !url)) {
    return (
      <div className="w-full aspect-video bg-surface border border-border rounded flex items-center justify-center">
        <span className="text-xs text-muted">Image not available</span>
      </div>
    );
  }

  if (!url) {
    return (
      <div
        className="w-full aspect-video bg-surface border border-border rounded flex items-center justify-center"
        data-testid="asset-loading"
      >
        <span className="text-xs text-muted">Loading image…</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className ?? "w-full rounded border border-border"}
    />
  );
}
