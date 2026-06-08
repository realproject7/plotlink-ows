import { useCallback, useEffect, useRef, useState } from "react";
import { GENRES, LANGUAGES, canonicalizeGenre } from "../../../lib/genres";
import { importImageToCompliantBlob } from "../lib/import-image";

interface StoryInfoPageProps {
  storyName: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  /** Notify the parent of saved publish metadata so its maps stay in sync. */
  onSaved?: (patch: { genre?: string; language?: string; isNsfw?: boolean }) => void;
}

type CoverState = "missing" | "present" | "invalid" | "unknown";

/**
 * Dedicated "Define Story Info" page for cartoon stories (#439, spec §4).
 *
 * Centralizes the public story-token metadata — title, short description, genre,
 * language, read-only content type, adult flag, and cover — into one clear page,
 * so Genesis can stay about the reader-facing Episode 1 content instead of
 * feeling like a publish form. All fields persist to `.story.json` through the
 * existing `/publish-metadata` route (no new on-chain contract surface); the
 * cover reuses the browser-convert → `/import-cover` flow the publish panel uses.
 *
 * Cartoon-only: the caller mounts this from the cartoon workflow nav, so fiction
 * metadata/publish behavior is untouched.
 */
export function StoryInfoPage({ storyName, authFetch, onSaved }: StoryInfoPageProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [genre, setGenre] = useState("");
  const [language, setLanguage] = useState("");
  const [isNsfw, setIsNsfw] = useState(false);
  const [contentType, setContentType] = useState<"fiction" | "cartoon">("cartoon");
  const [cover, setCover] = useState<CoverState>("unknown");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Load current values: story detail for the text fields (incl. description),
  // and the progress payload for the derived cover state. Reset display state on
  // every exit path so a failed reload can never leave stale fields showing.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setSaved(false);
    setSaveError(null);
    (async () => {
      try {
        const [detailRes, progressRes] = await Promise.all([
          authFetch(`/api/stories/${storyName}`),
          authFetch(`/api/stories/${storyName}/progress`),
        ]);
        if (!detailRes.ok) { if (!cancelled) { setLoadError(true); setLoading(false); } return; }
        const detail = await detailRes.json();
        const progress = progressRes.ok ? await progressRes.json().catch(() => null) : null;
        if (cancelled) return;
        setTitle(detail.title ?? "");
        setDescription(detail.description ?? "");
        setGenre(canonicalizeGenre(detail.genre) ?? "");
        setLanguage((detail.language && LANGUAGES.find((l) => l.toLowerCase() === detail.language.toLowerCase())) || "");
        setIsNsfw(!!detail.isNsfw);
        setContentType(detail.contentType === "fiction" ? "fiction" : "cartoon");
        setCover(progress?.cover ?? "unknown");
        setLoading(false);
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [storyName, authFetch]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    const patch = { title: title.trim(), description: description.trim(), genre, language, isNsfw };
    try {
      const res = await authFetch(`/api/stories/${storyName}/publish-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setSaved(true);
        onSaved?.({ genre, language, isNsfw });
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || "Could not save story info.");
      }
    } catch {
      setSaveError("Could not save story info.");
    }
    setSaving(false);
  }, [storyName, authFetch, title, description, genre, language, isNsfw, onSaved]);

  const handleCoverImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (coverInputRef.current) coverInputRef.current.value = "";
    if (!file) return;
    setImporting(true);
    setSaveError(null);
    try {
      let blob: Blob;
      try {
        blob = await importImageToCompliantBlob(file);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Could not import image");
        return;
      }
      const ext = blob.type === "image/jpeg" ? "jpg" : "webp";
      const imported = new File([blob], `cover.${ext}`, { type: blob.type });
      const formData = new FormData();
      formData.append("file", imported);
      const res = await authFetch(`/api/stories/${storyName}/import-cover`, { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || "Cover import failed.");
        return;
      }
      setCover("present");
      setCoverPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(imported); });
    } catch {
      setSaveError("Cover import failed.");
    } finally {
      setImporting(false);
    }
  }, [storyName, authFetch]);

  const copyCoverPrompt = useCallback(() => {
    const prompt = `Generate a cover image for this story (${title || storyName}) and save it as assets/cover.webp — portrait 600x900, WebP, under 1MB. Don't publish.`;
    navigator.clipboard?.writeText(prompt).then(() => { setPromptCopied(true); }).catch(() => {});
  }, [title, storyName]);

  if (loading) {
    return <div className="h-full flex items-center justify-center text-muted text-sm" data-testid="story-info-loading">Loading story info…</div>;
  }
  if (loadError) {
    return <div className="h-full flex items-center justify-center text-muted text-sm">Could not load story info.</div>;
  }

  const coverLabel = cover === "present" ? "Cover set" : cover === "invalid" ? "Invalid cover — re-import a WebP/JPEG under 1MB" : "Missing cover";
  const coverTone = cover === "present" ? "text-green-700" : cover === "invalid" ? "text-amber-700" : "text-muted";

  return (
    <div className="h-full overflow-y-auto px-4 py-4" data-testid="story-info-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-serif text-foreground">Story Info</h2>
          <p className="mt-0.5 text-[11px] text-muted">These details appear on PlotLink when the story is published.</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            <span className={`rounded-full border px-2 py-0.5 ${title.trim() ? "border-green-700/30 bg-green-700/10 text-green-700" : "border-border bg-background text-muted"}`}>
              Title {title.trim() ? "ready" : "missing"}
            </span>
            <span className={`rounded-full border px-2 py-0.5 ${genre ? "border-green-700/30 bg-green-700/10 text-green-700" : "border-border bg-background text-muted"}`}>
              Genre {genre ? "set" : "needed"}
            </span>
            <span className={`rounded-full border px-2 py-0.5 ${language ? "border-green-700/30 bg-green-700/10 text-green-700" : "border-border bg-background text-muted"}`}>
              Language {language ? "set" : "needed"}
            </span>
            <span className={`rounded-full border px-2 py-0.5 ${cover === "present" ? "border-green-700/30 bg-green-700/10 text-green-700" : "border-border bg-background text-muted"}`}>
              {cover === "present" ? "Cover ready" : "Cover missing"}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <button
            type="button" onClick={handleSave} disabled={saving}
            data-testid="story-info-save"
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-dim transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Story Info"}
          </button>
          {saved && <span className="text-[11px] text-green-700" data-testid="story-info-saved">Saved</span>}
          {saveError && <span className="text-[11px] text-error" data-testid="story-info-error">{saveError}</span>}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4 max-w-xl">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted">Public title</span>
          <input
            type="text" value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }}
            data-testid="story-info-title"
            className="w-full px-2 py-1.5 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted">Short description</span>
          <textarea
            value={description} onChange={(e) => { setDescription(e.target.value); setSaved(false); }}
            rows={3} data-testid="story-info-description"
            className="w-full px-2 py-1.5 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none resize-y"
          />
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 min-w-[140px] flex-1">
            <span className="text-[11px] font-medium text-muted">Genre</span>
            <select
              value={genre} onChange={(e) => { setGenre(e.target.value); setSaved(false); }}
              data-testid="story-info-genre"
              className="w-full px-2 py-1.5 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
            >
              <option value="">Needs metadata</option>
              {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1 min-w-[140px] flex-1">
            <span className="text-[11px] font-medium text-muted">Language</span>
            <select
              value={language} onChange={(e) => { setLanguage(e.target.value); setSaved(false); }}
              data-testid="story-info-language"
              className="w-full px-2 py-1.5 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
            >
              <option value="">Needs metadata</option>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1 min-w-[140px] flex-1">
            <span className="text-[11px] font-medium text-muted">Content type</span>
            <span
              className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-muted"
              data-testid="story-info-content-type"
              title="Content type is locked after creation."
            >
              {contentType === "cartoon" ? "Cartoon · locked" : "Fiction · locked"}
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted">Cover image</span>
          <div className="flex items-start gap-3">
            {coverPreview && (
              <img src={coverPreview} alt="Cover preview" className="w-16 h-24 object-cover rounded border border-border" />
            )}
            <div className="flex flex-col gap-1.5">
              <span className={`text-[11px] font-medium ${coverTone}`} data-testid="story-info-cover-status">{coverLabel}</span>
              <span className="text-[10px] text-muted">WebP or JPEG, max 1MB, 600×900 recommended.</span>
              <div className="flex items-center gap-2">
                <button
                  type="button" onClick={() => coverInputRef.current?.click()} disabled={importing}
                  data-testid="story-info-import-cover"
                  className="rounded border border-border px-2.5 py-1 text-[11px] text-foreground hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                >
                  {importing ? "Importing…" : "Import cover"}
                </button>
                <button
                  type="button" onClick={copyCoverPrompt}
                  data-testid="story-info-cover-prompt"
                  className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:border-accent hover:text-accent transition-colors"
                >
                  {promptCopied ? "Copied!" : "Ask agent for cover prompt"}
                </button>
              </div>
              <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverImport} className="hidden" />
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox" checked={isNsfw} onChange={(e) => { setIsNsfw(e.target.checked); setSaved(false); }}
            data-testid="story-info-nsfw"
          />
          <span className="text-xs text-foreground">This story contains adult content (18+)</span>
        </label>
      </div>
    </div>
  );
}
