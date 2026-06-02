import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { GENRES, LANGUAGES } from "../../../lib/genres";
import { CartoonPreview } from "./CartoonPreview";
import { CartoonPublishPreview } from "./CartoonPublishPreview";
import { CutListPanel } from "./CutListPanel";
import { classifyCartoonReadiness, type CartoonReadinessStage as CartoonStage } from "@app-lib/cartoon-readiness";
import { validateCoverImage } from "../lib/publish-helpers";

/** Custom sanitizer matching plotlink.xyz — allows img with src, alt, title */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: ["src", "alt", "title"],
  },
};

const IPFS_GATEWAY = "https://ipfs.filebase.io/ipfs/";

/** Find all markdown image references in content */
function findImageRefs(text: string): Array<{ full: string; alt: string; url: string }> {
  const results: Array<{ full: string; alt: string; url: string }> = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push({ full: m[0], alt: m[1], url: m[2] });
  }
  return results;
}

/** Validate image references for publishing */
function validateImageRefs(text: string): { count: number; warnings: string[] } {
  const refs = findImageRefs(text);
  const warnings: string[] = [];
  for (const ref of refs) {
    if (!ref.url.startsWith(IPFS_GATEWAY)) {
      warnings.push(`Non-IPFS image URL: ${ref.url.length > 60 ? ref.url.slice(0, 60) + "..." : ref.url}`);
    }
  }
  // Check for malformed image markdown (missing closing bracket/paren)
  const malformed = text.match(/!\[[^\]]*\]\([^)]*$|!\[[^\]]*$(?!\])/gm);
  if (malformed) {
    warnings.push("Malformed image markdown detected — check brackets and parentheses");
  }
  return { count: refs.length, warnings };
}

interface PreviewPanelProps {
  storyName: string | null;
  fileName: string | null;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  onPublish?: (storyName: string, fileName: string, genre: string, language: string, isNsfw: boolean, coverFile?: File | null) => void;
  publishingFile?: string | null;
  walletAddress?: string | null;
  contentType?: "fiction" | "cartoon";
  language?: string;
}

interface FileData {
  file: string;
  status: "published" | "published-not-indexed" | "pending" | "draft";
  content: string;
  txHash?: string;
  storylineId?: number;
  plotIndex?: number;
  indexError?: string;
  publishedAt?: string;
  authorAddress?: string;
}

type Tab = "preview" | "edit";

export function PreviewPanel({ storyName, fileName, authFetch, onPublish, publishingFile, walletAddress, contentType = "fiction", language }: PreviewPanelProps) {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("preview");
  // Cartoon preview sub-mode: "publish" = exact PlotLink-bound markdown;
  // "inspect" = cuts.json planning inspector. Kept distinct so planning prose
  // does not masquerade as publish content (#289).
  const [cartoonPreviewMode, setCartoonPreviewMode] = useState<"publish" | "inspect">("publish");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [indexTimeLeft, setIndexTimeLeft] = useState<number | null>(null);
  const [selectedGenre, setSelectedGenre] = useState(GENRES[0]);
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGES[0]);
  const [isNsfw, setIsNsfw] = useState(false);
  const [cartoonIssues, setCartoonIssues] = useState<string[]>([]);
  const [cartoonStage, setCartoonStage] = useState<CartoonStage | null>(null);
  const [cartoonAwaitingCount, setCartoonAwaitingCount] = useState(0);
  const [cartoonTotalCuts, setCartoonTotalCuts] = useState(0);
  const [cartoonGenerating, setCartoonGenerating] = useState(false);
  const [cartoonGenWarnings, setCartoonGenWarnings] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirtyRef = useRef(false);

  // Edit panel state for published stories
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [editGenre, setEditGenre] = useState(GENRES[0] as string);
  const [editLanguage, setEditLanguage] = useState(LANGUAGES[0] as string);
  const [editNsfw, setEditNsfw] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editMetaLoaded, setEditMetaLoaded] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  // Auto-detected agent-created cover (assets/cover.webp|jpg) for genesis (#296).
  // detectedCover = the path actually loaded into the cover selection (status
  // label); detectedCoverWarning = an invalid/oversize detected asset we won't use.
  const [detectedCover, setDetectedCover] = useState<string | null>(null);
  const [detectedCoverWarning, setDetectedCoverWarning] = useState<string | null>(null);
  // Once the writer manually picks or removes a cover, stop auto-applying the
  // detected one (so removal/override sticks and detection doesn't loop).
  const coverUserTouchedRef = useRef(false);

  // Inline illustration state
  const [showIllustrations, setShowIllustrations] = useState(false);
  const [illustrationUploading, setIllustrationUploading] = useState(false);
  const [illustrationError, setIllustrationError] = useState<string | null>(null);
  const [uploadedImages, setUploadedImages] = useState<Array<{ cid: string; url: string }>>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const illustrationInputRef = useRef<HTMLInputElement>(null);

  const prevFileRef = useRef<string | null>(null);

  const loadFile = useCallback(async () => {
    if (!storyName || !fileName) { setFileData(null); return; }
    const fileKey = `${storyName}/${fileName}`;
    const isNewFile = prevFileRef.current !== fileKey;
    if (isNewFile) {
      prevFileRef.current = fileKey;
    }
    try {
      const res = await authFetch(`/api/stories/${storyName}/${fileName}`);
      if (res.ok) {
        const data: FileData = await res.json();
        setFileData(data);
        // Update edit content on new file or when no unsaved changes
        if (isNewFile || !dirtyRef.current) {
          setEditContent(data.content ?? "");
          if (isNewFile) { setDirty(false); dirtyRef.current = false; }
        }
      }
    } catch { /* ignore */ }
  }, [storyName, fileName, authFetch]);

  // Initial load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    setLoading(true);
    loadFile().finally(() => setLoading(false));
  }, [loadFile]);

  // Auto-refresh every 3 seconds (only in preview mode when not dirty)
  useEffect(() => {
    if (!storyName || !fileName) return;
    if (activeTab === "edit" && dirty) return;
    const interval = setInterval(loadFile, 3000);
    return () => clearInterval(interval);
  }, [storyName, fileName, loadFile, activeTab, dirty]);

  // Compute cartoon publish readiness for cartoon plot files
  const cartoonPlotForReadiness = contentType === "cartoon" && !!fileName && /^plot-\d+\.md$/.test(fileName);
  useEffect(() => {
    if (!cartoonPlotForReadiness || !storyName || !fileName) {
      setCartoonIssues([]);
      setCartoonStage(null);
      setCartoonAwaitingCount(0);
      setCartoonTotalCuts(0);
      return;
    }
    let cancelled = false;
    const plotFile = fileName.replace(/\.md$/, "");
    (async () => {
      try {
        const [fileRes, cutsRes] = await Promise.all([
          authFetch(`/api/stories/${storyName}/${fileName}`),
          authFetch(`/api/stories/${storyName}/cuts/${plotFile}`),
        ]);
        if (cancelled) return;
        if (!cutsRes.ok) {
          setCartoonIssues(["Cuts file missing or invalid — generate cuts and upload images first"]);
          setCartoonStage("error");
          setCartoonAwaitingCount(0);
          setCartoonTotalCuts(0);
          return;
        }
        const cutsData = await cutsRes.json();
        const cuts = cutsData.cuts || [];
        const content = fileRes.ok ? (await fileRes.json()).content ?? "" : "";
        const result = classifyCartoonReadiness(content, cuts);
        if (!cancelled) {
          setCartoonIssues(result.issues);
          setCartoonStage(result.stage);
          setCartoonAwaitingCount(result.awaitingCount);
          setCartoonTotalCuts(result.totalCuts);
        }
      } catch {
        if (!cancelled) {
          setCartoonIssues(["Could not verify publish readiness"]);
          setCartoonStage("error");
          setCartoonAwaitingCount(0);
          setCartoonTotalCuts(0);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [cartoonPlotForReadiness, storyName, fileName, authFetch, fileData?.content]);

  // Auto-detect genre from structure.md when story changes
  useEffect(() => {
    if (!storyName) return;
    let cancelled = false;
    authFetch(`/api/stories/${storyName}/structure.md`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled || !data?.content) return;
        const match = data.content.match(/\*{0,2}genre\*{0,2}[:\s]+(.+)/i);
        if (match) {
          const detected = match[1].replace(/\*+/g, "").trim();
          const found = GENRES.find((g) => g.toLowerCase() === detected.toLowerCase());
          if (found) setSelectedGenre(found);
        }
        const langMatch = data.content.match(/\*{0,2}language\*{0,2}[:\s]+(.+)/i);
        if (langMatch) {
          const detected = langMatch[1].replace(/\*+/g, "").trim();
          const found = LANGUAGES.find((l) => l.toLowerCase() === detected.toLowerCase());
          if (found) setSelectedLanguage(found);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [storyName, authFetch]);

  const handleSave = useCallback(async () => {
    if (!storyName || !fileName) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/stories/${storyName}/${fileName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        setDirty(false); dirtyRef.current = false;
        setFileData((prev) => prev ? { ...prev, content: editContent } : prev);
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [storyName, fileName, authFetch, editContent]);

  // Generate the cartoon markdown skeleton from the cut plan, then refresh
  // preview/readiness so the planning callout gives way to the upload-stage state.
  const handleGenerateMarkdown = useCallback(async () => {
    if (!storyName || !fileName) return;
    const plotFile = fileName.replace(/\.md$/, "");
    setCartoonGenerating(true);
    setCartoonGenWarnings([]);
    try {
      const res = await authFetch(`/api/stories/${storyName}/cuts/${plotFile}/generate-markdown`, { method: "POST" });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setCartoonGenWarnings(data.warnings || []);
        await loadFile();
      }
    } catch { /* ignore */ }
    setCartoonGenerating(false);
  }, [storyName, fileName, authFetch, loadFile]);

  // Handle cover image selection
  const handleCoverSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // A manual pick overrides any auto-detected cover and stops re-detection.
    coverUserTouchedRef.current = true;
    setDetectedCover(null);
    // Reject oversized / non-WebP-JPEG covers at selection so the writer gets
    // immediate feedback instead of a late error at save (the server enforces
    // the same WebP/JPEG ≤1MB constraint).
    const error = validateCoverImage(file);
    if (error) {
      // Discard any previously-queued valid cover and clear the input, so an
      // invalid re-selection can't leave a stale cover that Save would still
      // upload contrary to the user's latest choice (#281 follow-up).
      setCoverFile(null);
      setCoverPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      if (coverInputRef.current) coverInputRef.current.value = "";
      setEditError(error);
      return;
    }
    setCoverFile(file);
    setCoverPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    setEditError(null);
  }, []);

  // Handle illustration image upload from File object
  const uploadIllustration = useCallback(async (file: File) => {
    if (file.size > 1024 * 1024) {
      setIllustrationError("Image exceeds 1MB limit");
      return;
    }
    const allowedTypes = ["image/webp", "image/jpeg"];
    if (!allowedTypes.includes(file.type)) {
      setIllustrationError("Only WebP and JPEG images are accepted");
      return;
    }
    setIllustrationUploading(true);
    setIllustrationError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch("/api/publish/upload-plot-image", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      setUploadedImages((prev) => [...prev, { cid: data.cid, url: data.url }]);
    } catch (err) {
      setIllustrationError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIllustrationUploading(false);
      if (illustrationInputRef.current) illustrationInputRef.current.value = "";
    }
  }, [authFetch]);

  const handleIllustrationInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadIllustration(file);
  }, [uploadIllustration]);

  // Save storyline edits (cover upload + metadata update)
  const handleEditSave = useCallback(async () => {
    if (!fileData?.storylineId) return;
    setEditSaving(true);
    setEditError(null);
    setEditSuccess(false);

    try {
      let coverCid: string | undefined;

      // Upload cover image if selected
      if (coverFile) {
        const formData = new FormData();
        formData.append("file", coverFile);
        const uploadRes = await authFetch("/api/publish/upload-cover", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          throw new Error(err.error || "Cover upload failed");
        }
        const uploadData = await uploadRes.json();
        coverCid = uploadData.cid;
      }

      // Update storyline metadata
      const updateRes = await authFetch("/api/publish/update-storyline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storylineId: fileData.storylineId,
          ...(coverCid !== undefined && { coverCid }),
          genre: editGenre,
          language: editLanguage,
          isNsfw: editNsfw,
        }),
      });

      if (!updateRes.ok) {
        const err = await updateRes.json();
        throw new Error(err.error || "Update failed");
      }

      setEditSuccess(true);
      setCoverFile(null);
      setTimeout(() => setEditSuccess(false), 3000);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setEditSaving(false);
    }
  }, [fileData?.storylineId, coverFile, editGenre, editLanguage, editNsfw, authFetch]);

  // Reset edit panel state when changing files
  useEffect(() => {
    setShowEditPanel(false);
    setCoverFile(null);
    setCoverPreview(null);
    setEditError(null);
    setEditSuccess(false);
    setEditMetaLoaded(false);
    setShowIllustrations(false);
    setUploadedImages([]);
    setIllustrationError(null);
    setDetectedCover(null);
    setDetectedCoverWarning(null);
    coverUserTouchedRef.current = false;
  }, [storyName, fileName]);

  // Auto-detect an agent-created cover (assets/cover.webp|jpg) for an UNPUBLISHED
  // genesis and offer it as the default pre-publish cover (#296). Loads the file
  // into the same coverFile/coverPreview the manual picker uses, so the existing
  // publish flow attaches it (upload-cover → update-storyline) with no special
  // casing. Invalid/oversize detected assets surface as a warning and are NOT used.
  useEffect(() => {
    if (fileName !== "genesis.md" || !storyName) return;
    // Wait for the file to load AND confirm it is genuinely unpublished before
    // touching the shared coverFile/coverPreview. On first render fileData is
    // null, so without this an auto-detected cover could be set before the file
    // load resolves and then leak into the published Edit Story panel (re1).
    if (!fileData) return;
    if (fileData.storylineId || fileData.status === "published" || fileData.status === "published-not-indexed") return;
    if (coverUserTouchedRef.current) return; // a manual pick/removal wins
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/api/stories/${storyName}/cover-asset`);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.found) return;
        if (!data.valid) {
          setDetectedCoverWarning(data.error || "Detected cover asset is invalid and was not used");
          return;
        }
        const assetRes = await authFetch(`/api/stories/${storyName}/asset/${data.path.replace(/^assets\//, "")}`);
        if (cancelled || !assetRes.ok) return;
        const blob = await assetRes.blob();
        const file = new File([blob], data.path.split("/").pop() || "cover.webp", { type: data.type });
        // Reuse the exact client validation the manual picker uses.
        if (validateCoverImage(file) || cancelled || coverUserTouchedRef.current) return;
        setCoverFile(file);
        setCoverPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
        setDetectedCover(data.path);
      } catch { /* best-effort: no detected cover */ }
    })();
    return () => { cancelled = true; };
  }, [storyName, fileName, fileData, fileData?.status, fileData?.storylineId, authFetch]);

  // Fetch current storyline metadata when edit panel opens
  useEffect(() => {
    if (!showEditPanel || !fileData?.storylineId) return;
    setEditMetaLoaded(false);
    const PLOTLINK_URL = "https://plotlink.xyz";
    let cancelled = false;
    fetch(`${PLOTLINK_URL}/api/storyline/${fileData.storylineId}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setEditError("Could not load current story metadata");
          return;
        }
        if (data.genre) {
          const found = GENRES.find((g) => g.toLowerCase() === data.genre.toLowerCase());
          if (found) setEditGenre(found);
        }
        if (data.language) {
          const found = LANGUAGES.find((l) => l.toLowerCase() === data.language.toLowerCase());
          if (found) setEditLanguage(found);
        }
        if (data.isNsfw !== undefined) setEditNsfw(!!data.isNsfw);
        setEditMetaLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setEditError("Could not load current story metadata");
      });
    return () => { cancelled = true; };
  }, [showEditPanel, fileData?.storylineId]);

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    if (activeTab !== "edit") return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, handleSave]);

  // 5-minute countdown for Retry Index button
  useEffect(() => {
    if (fileData?.status !== "published-not-indexed" || !fileData.publishedAt) {
      return;
    }
    const publishedAt = new Date(fileData.publishedAt).getTime();
    const windowMs = 5 * 60 * 1000;
    const update = () => {
      const remaining = Math.max(0, windowMs - (Date.now() - publishedAt));
      setIndexTimeLeft(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [fileData?.status, fileData?.publishedAt]);

  const indexExpired = indexTimeLeft !== null && indexTimeLeft <= 0;
  const indexCountdown = indexTimeLeft !== null && indexTimeLeft > 0
    ? `${Math.floor(indexTimeLeft / 60000)}:${String(Math.floor((indexTimeLeft % 60000) / 1000)).padStart(2, "0")}`
    : null;

  if (!storyName || !fileName) {
    return (
      <div className="h-full flex items-center justify-center text-muted">
        <div className="text-center">
          <p className="text-lg font-serif">Select a file to preview</p>
          <p className="text-sm mt-1">Click a story file in the sidebar</p>
        </div>
      </div>
    );
  }

  if (loading && !fileData) {
    return (
      <div className="h-full flex items-center justify-center text-muted">
        Loading...
      </div>
    );
  }

  const content = activeTab === "edit" ? editContent : (fileData?.content ?? "");
  const charCount = content.length;
  const isGenesis = fileName === "genesis.md";
  const isPlot = fileName ? /^plot-\d+\.md$/.test(fileName) : false;
  const isCartoonPlot = contentType === "cartoon" && isPlot;
  const isPublished = fileData?.status === "published" || fileData?.status === "published-not-indexed";
  const charLimit = (isGenesis || isPlot) ? 10000 : null;
  // Don't show over-limit warning for already-published files
  const overLimit = !isPublished && charLimit !== null && charCount > charLimit;

  // Pre-publish image validation for pending content
  const publishContent = fileData?.content ?? "";
  const imageValidation = !isPublished ? validateImageRefs(publishContent) : { count: 0, warnings: [] };

  return (
    <div className="h-full flex flex-col">
      {/* Header with file path + tabs */}
      <div className="border-b border-border">
        <div className="px-3 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono text-muted">
            <span>{storyName}/{fileName}</span>
            {fileData?.status === "published" && (
              <span className="text-green-700 font-medium">Published</span>
            )}
            {fileData?.status === "published-not-indexed" && (
              <span className="text-amber-700 font-medium" title={fileData.indexError}>Published (not indexed)</span>
            )}
            {fileData?.status === "pending" && (
              <span className="text-amber-700 font-medium">Pending</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono ${overLimit ? "text-error font-medium" : "text-muted"}`}>
              {charCount.toLocaleString()}{charLimit !== null ? `/${charLimit.toLocaleString()}` : " chars"}
            </span>
            {overLimit && (
              <span className="text-error text-xs font-medium">
                {(charCount - charLimit).toLocaleString()} over limit
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-3 gap-1">
          <button
            onClick={() => setActiveTab("preview")}
            className={`px-3 py-1 text-xs font-medium border-b-2 transition-colors ${
              activeTab === "preview"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Preview
          </button>
          <button
            onClick={() => setActiveTab("edit")}
            className={`px-3 py-1 text-xs font-medium border-b-2 transition-colors ${
              activeTab === "edit"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Edit
            {dirty && <span className="ml-1 text-amber-600">*</span>}
          </button>
        </div>
      </div>

      {/* Content area */}
      {activeTab === "preview" ? (
        isCartoonPlot ? (
          <div className="flex-1 min-h-0 flex flex-col" style={{ background: "var(--paper-bg)" }}>
            {/* Two explicit modes: Publish Preview (exact PlotLink markdown) vs
                Cut Inspector (cuts.json planning metadata) — see #289. */}
            <div className="flex gap-1 px-3 py-1 border-b border-border">
              <button
                data-testid="cartoon-mode-publish"
                onClick={() => setCartoonPreviewMode("publish")}
                className={`px-2 py-0.5 text-[11px] rounded ${cartoonPreviewMode === "publish" ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
              >
                Publish Preview
              </button>
              <button
                data-testid="cartoon-mode-inspect"
                onClick={() => setCartoonPreviewMode("inspect")}
                className={`px-2 py-0.5 text-[11px] rounded ${cartoonPreviewMode === "inspect" ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
              >
                Cut Inspector
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {cartoonPreviewMode === "publish" ? (
                <CartoonPublishPreview content={fileData?.content ?? ""} stage={cartoonStage} />
              ) : (
                <CartoonPreview storyName={storyName!} fileName={fileName!} authFetch={authFetch} />
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4" style={{ background: "var(--paper-bg)" }}>
            {fileData?.content ? (
              <div className="prose max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkBreaks, remarkGfm]}
                  rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
                >
                  {fileData.content}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-muted italic">No content</p>
            )}
          </div>
        )
      ) : isCartoonPlot ? (
        <div className="flex-1 min-h-0" style={{ background: "var(--paper-bg)" }}>
          <CutListPanel storyName={storyName!} fileName={fileName!} authFetch={authFetch} language={language} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col" style={{ background: "var(--paper-bg)" }}>
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => { setEditContent(e.target.value); setDirty(true); dirtyRef.current = true; }}
            className="flex-1 min-h-0 w-full resize-none px-4 py-3 text-sm leading-relaxed focus:outline-none"
            style={{
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              background: "var(--paper-bg)",
              color: "var(--text)",
            }}
            spellCheck={false}
          />
          <div className="px-3 py-1.5 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted">
              {dirty ? "Unsaved changes" : "No changes"}
            </span>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-3 py-1 bg-accent text-white text-xs rounded hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="px-3 py-2 border-t border-border flex items-center justify-between">
        {fileName === "structure.md" ? (
          <p className="text-muted text-xs italic">This is your story outline — not publishable. Ask AI to write the genesis next.</p>
        ) : fileData?.status === "published-not-indexed" ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-amber-700">Published on-chain but not indexed on PlotLink</span>
              {!indexExpired && (
                <button
                  onClick={async () => {
                    if (!storyName || !fileName || !fileData.txHash) return;
                    setRetrying(true);
                    try {
                      const res = await authFetch("/api/publish/retry-index", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          storyName, fileName,
                          txHash: fileData.txHash,
                          content: fileData.content,
                          storylineId: fileData.storylineId,
                        }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        await authFetch(`/api/stories/${storyName}/${fileName}/publish-status`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            txHash: fileData.txHash,
                            storylineId: fileData.storylineId,
                            contentCid: "",
                            gasCost: "",
                          }),
                        });
                        loadFile();
                      }
                    } catch { /* ignore */ }
                    setRetrying(false);
                  }}
                  disabled={retrying}
                  className="px-3 py-1 bg-accent text-white text-xs rounded hover:bg-accent-dim disabled:opacity-50"
                >
                  {retrying ? "Retrying..." : `Retry Index${indexCountdown ? ` (${indexCountdown})` : ""}`}
                </button>
              )}
              {isPlot && (
                <button
                  onClick={() => storyName && fileName && onPublish?.(storyName, fileName, selectedGenre, selectedLanguage, isNsfw)}
                  disabled={!!publishingFile}
                  className="px-3 py-1 border border-border text-xs rounded hover:bg-surface disabled:opacity-50"
                >
                  {publishingFile === fileName ? "Publishing..." : "Retry Publish"}
                </button>
              )}
              {fileData.txHash && (
                <a
                  href={`https://basescan.org/tx/${fileData.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted underline"
                >
                  BaseScan
                </a>
              )}
            </div>
            <p className="text-muted text-xs">
              {indexExpired
                ? isPlot
                  ? "Index window expired. Use Retry Publish to create a new on-chain tx."
                  : "Index window expired. Contact support or re-publish manually."
                : isPlot
                  ? "Try Retry Index first (available for 5 min after publish). If that fails, Retry Publish creates a new on-chain tx."
                  : "Retry Index is available for 5 min after publish."}
            </p>
            {fileData.indexError && (
              <p className="text-error text-xs">{fileData.indexError}</p>
            )}
          </div>
        ) : fileData?.status === "published" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-green-700">Published</span>
              {fileData.storylineId && (
                <a
                  href={(() => {
                    const base = `https://plotlink.xyz/story/${fileData.storylineId}`;
                    if (!isPlot) return base;
                    const idx = fileData.plotIndex != null && fileData.plotIndex > 0
                      ? fileData.plotIndex
                      : parseInt(fileName?.match(/^plot-(\d+)\.md$/)?.[1] ?? "1");
                    return `${base}/${idx}`;
                  })()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline"
                >
                  View on PlotLink
                </a>
              )}
              {fileData.txHash && (
                <a
                  href={`https://basescan.org/tx/${fileData.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted underline"
                >
                  BaseScan
                </a>
              )}
              {isGenesis && walletAddress && fileData.storylineId && (!fileData.authorAddress || fileData.authorAddress.toLowerCase() === walletAddress.toLowerCase()) && (
                <button
                  onClick={() => setShowEditPanel((v) => !v)}
                  className="px-2 py-0.5 border border-border text-xs rounded hover:bg-surface"
                >
                  {showEditPanel ? "Close Edit" : "Edit Story"}
                </button>
              )}
            </div>
            {/* Edit panel for published genesis files */}
            {showEditPanel && isGenesis && fileData.storylineId && (
              <div className="border border-border rounded p-3 flex flex-col gap-3 bg-surface">
                {/* Cover image upload */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Cover Image</span>
                  <div className="flex items-start gap-3">
                    {coverPreview && (
                      <div className="relative">
                        <img
                          src={coverPreview}
                          alt="Cover preview"
                          className="w-16 h-24 object-cover rounded border border-border"
                        />
                        <button
                          onClick={() => { setCoverFile(null); setCoverPreview(null); if (coverInputRef.current) coverInputRef.current.value = ""; }}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-error text-white rounded-full text-xs flex items-center justify-center"
                        >
                          x
                        </button>
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/webp,image/jpeg"
                        onChange={handleCoverSelect}
                        className="text-xs"
                        data-testid="cover-input"
                      />
                      <span className="text-xs text-muted">WebP/JPEG, max 1MB, 600x900px recommended</span>
                    </div>
                  </div>
                </div>
                {/* Genre & Language */}
                <div className="flex items-center gap-2">
                  <select
                    value={editGenre}
                    onChange={(e) => setEditGenre(e.target.value)}
                    className="px-2 py-1.5 text-xs border border-border rounded bg-surface text-foreground"
                  >
                    {GENRES.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                  <select
                    value={editLanguage}
                    onChange={(e) => setEditLanguage(e.target.value)}
                    className="px-2 py-1.5 text-xs border border-border rounded bg-surface text-foreground"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                {/* NSFW toggle */}
                <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editNsfw}
                    onChange={(e) => setEditNsfw(e.target.checked)}
                    className="rounded border-border"
                  />
                  This story contains adult content (18+)
                </label>
                {/* Save / status */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleEditSave}
                    disabled={editSaving || !editMetaLoaded}
                    className="px-3 py-1 bg-accent text-white text-xs rounded hover:bg-accent-dim disabled:opacity-50"
                  >
                    {editSaving ? "Saving..." : !editMetaLoaded ? "Loading..." : "Save Changes"}
                  </button>
                  {editSuccess && <span className="text-green-700 text-xs">Updated!</span>}
                  {editError && <span className="text-error text-xs">{editError}</span>}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Cartoon planning-stage callout: cut plan exists but markdown skeleton
                is missing. Surface Generate MD as the next action instead of red errors. */}
            {isCartoonPlot && cartoonStage === "planning" && (
              <div
                className="flex flex-col gap-2 border border-accent/30 bg-accent/5 rounded p-3"
                data-testid="cartoon-planning-callout"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-foreground">Cut plan ready — generate the episode markdown</span>
                  <span className="text-xs text-muted">
                    A valid cut plan exists, but the episode markdown skeleton hasn&apos;t been generated yet. Generate it before lettering and uploading images.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGenerateMarkdown}
                    disabled={cartoonGenerating}
                    className="px-3 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="generate-md-preview-btn"
                  >
                    {cartoonGenerating ? "Generating..." : "Generate MD"}
                  </button>
                  {cartoonGenWarnings.length > 0 && (
                    <span className="text-amber-600 text-xs">{cartoonGenWarnings.length} cut(s) still need images</span>
                  )}
                </div>
              </div>
            )}
            {/* Cartoon awaiting-upload state: every cut block exists but final
                images haven't been uploaded yet. Calm, non-red pending status
                that makes the next action clear, NOT a wall of errors. */}
            {isCartoonPlot && cartoonStage === "awaiting-upload" && (
              <div
                className="flex flex-col gap-1 border border-accent/30 bg-accent/5 rounded p-3"
                data-testid="cartoon-awaiting-upload"
              >
                <span className="text-xs font-medium text-foreground">Markdown skeleton generated</span>
                <span className="text-xs text-muted">
                  {cartoonAwaitingCount} of {cartoonTotalCuts} cuts awaiting final uploaded images
                </span>
                <span className="text-xs text-muted">
                  Next: generate/import clean images, letter them, export final images, then upload.
                </span>
              </div>
            )}
            {/* Inline illustration upload for plot files (Preview tab only) */}
            {isPlot && !isCartoonPlot && activeTab === "preview" && (
              <div>
                <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showIllustrations}
                    onChange={(e) => setShowIllustrations(e.target.checked)}
                    className="rounded border-border"
                  />
                  Add illustrations in the plot
                </label>
                {showIllustrations && (
                  <div className="mt-2 flex flex-col gap-2">
                    <div
                      className="border-2 border-dashed border-border rounded p-3 flex flex-col items-center gap-1.5 cursor-pointer hover:border-accent transition-colors"
                      onClick={() => illustrationInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const file = e.dataTransfer.files?.[0];
                        if (file) uploadIllustration(file);
                      }}
                    >
                      <input
                        ref={illustrationInputRef}
                        type="file"
                        accept="image/webp,image/jpeg"
                        onChange={handleIllustrationInput}
                        className="hidden"
                      />
                      <span className="text-xs text-muted">
                        {illustrationUploading ? "Uploading..." : "Drop image here or click to browse"}
                      </span>
                      <span className="text-xs text-muted">WebP/JPEG, max 1MB</span>
                    </div>
                    {illustrationError && (
                      <span className="text-error text-xs">{illustrationError}</span>
                    )}
                    {uploadedImages.map((img, i) => (
                      <div key={img.cid} className="border border-border rounded p-2 flex flex-col gap-1 bg-surface">
                        <span className="text-xs text-green-700">Image uploaded! Copy the markdown below and paste it where you want the illustration to appear in your plot:</span>
                        <div className="flex items-center gap-1.5">
                          <code className="flex-1 text-xs bg-background px-2 py-1 rounded font-mono break-all">
                            ![Scene description]({img.url})
                          </code>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(`![Scene description](${img.url})`);
                              setCopiedIndex(i);
                              setTimeout(() => setCopiedIndex(null), 2000);
                            }}
                            className="px-2 py-1 text-xs border border-border rounded hover:bg-surface shrink-0"
                          >
                            {copiedIndex === i ? "Copied!" : "Copy"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Pre-publish cover picker (#284): a new genesis (esp. cartoon)
                gets a cover before its first createStoryline. Reuses the same
                validation/stale-clear as the published Edit Story panel; the
                selected file is handed to the publish flow, which uploads it and
                sets it on the storyline once it exists. */}
            {isGenesis && (
              <div className="flex flex-col gap-1.5" data-testid="prepublish-cover">
                <span className="text-xs font-medium text-foreground">Cover Image <span className="text-muted font-normal">(optional)</span></span>
                <div className="flex items-start gap-3">
                  {coverPreview && (
                    <div className="relative">
                      <img
                        src={coverPreview}
                        alt="Cover preview"
                        className="w-16 h-24 object-cover rounded border border-border"
                      />
                      <button
                        onClick={() => { coverUserTouchedRef.current = true; setDetectedCover(null); setCoverFile(null); setCoverPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; }); if (coverInputRef.current) coverInputRef.current.value = ""; }}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-error text-white rounded-full text-xs flex items-center justify-center"
                      >
                        x
                      </button>
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/webp,image/jpeg"
                      onChange={handleCoverSelect}
                      className="text-xs"
                      data-testid="prepublish-cover-input"
                    />
                    <span className="text-xs text-muted">WebP/JPEG, max 1MB, 600x900px recommended</span>
                    {detectedCover && (
                      <span className="text-accent text-xs" data-testid="prepublish-cover-detected">
                        Detected {detectedCover} — will be used as the cover. Pick a file to override.
                      </span>
                    )}
                    {detectedCoverWarning && (
                      <span className="text-amber-700 text-xs" data-testid="prepublish-cover-detected-warning">
                        {detectedCoverWarning}
                      </span>
                    )}
                    {editError && <span className="text-error text-xs" data-testid="prepublish-cover-error">{editError}</span>}
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              {(isGenesis) && (
                <>
                  <select
                    value={selectedGenre}
                    onChange={(e) => setSelectedGenre(e.target.value)}
                    className="px-2 py-1.5 text-xs border border-border rounded bg-surface text-foreground"
                  >
                    {GENRES.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                  <select
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                    className="px-2 py-1.5 text-xs border border-border rounded bg-surface text-foreground"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </>
              )}
              <button
                onClick={() => {
                  if (!storyName || !fileName) return;
                  if (imageValidation.count > 0) {
                    const msg = `This plot contains ${imageValidation.count} illustration(s). Content is immutable after publishing — image references cannot be changed or removed.\n\nPlease verify illustrations appear correctly in Preview before continuing.\n\nPublish now?`;
                    if (!window.confirm(msg)) return;
                  }
                  // Genesis carries the optional pre-publish cover (#284); plot
                  // files never do. Only pass the 6th arg when a cover is
                  // actually selected, so the no-cover call signature (and
                  // existing fiction/plot publish behavior) is unchanged.
                  // The cover may be a manual pick OR an auto-detected
                  // assets/cover.webp loaded into coverFile (#296) — both flow
                  // through the same attach path.
                  const cover = isGenesis ? coverFile : null;
                  if (cover) {
                    onPublish?.(storyName, fileName, selectedGenre, selectedLanguage, isNsfw, cover);
                    // Hand the file to the parent's publish flow, then drop the
                    // local selection so it can't linger into the Edit panel or be
                    // re-applied by cover auto-detection.
                    coverUserTouchedRef.current = true;
                    setDetectedCover(null);
                    setCoverFile(null);
                    setCoverPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
                    if (coverInputRef.current) coverInputRef.current.value = "";
                  } else {
                    onPublish?.(storyName, fileName, selectedGenre, selectedLanguage, isNsfw);
                  }
                }}
                disabled={!!publishingFile || overLimit || (isCartoonPlot && cartoonStage !== "ready")}
                className="px-4 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {publishingFile === fileName ? "Publishing..." : "Publish to PlotLink"}
              </button>
              {overLimit && (
                <span className="text-error text-xs">Reduce content to publish</span>
              )}
              {isCartoonPlot && cartoonStage === "error" && (
                <span className="text-error text-xs">Not ready to publish</span>
              )}
              {isCartoonPlot && cartoonStage === "planning" && (
                <span className="text-muted text-xs">Generate markdown to continue</span>
              )}
            </div>
            {isCartoonPlot && cartoonStage === "error" && cartoonIssues.length > 0 && (
              <div className="flex flex-col gap-0.5" data-testid="cartoon-publish-issues">
                {cartoonIssues.map((issue, i) => (
                  <span key={i} className="text-error text-xs">{issue}</span>
                ))}
              </div>
            )}
            {imageValidation.warnings.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {imageValidation.warnings.map((w, i) => (
                  <span key={i} className="text-amber-600 text-xs">{w}</span>
                ))}
              </div>
            )}
            {(isGenesis) && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isNsfw}
                    onChange={(e) => setIsNsfw(e.target.checked)}
                    className="rounded border-border"
                  />
                  This story contains adult content (18+)
                </label>
                {isNsfw && (
                  <span className="text-xs text-amber-600">Adult content will be hidden from the default browse view.</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
