import { useState, useCallback, useRef, useEffect } from "react";
import { StoryBrowser } from "./StoryBrowser";
import { TerminalPanel } from "./TerminalPanel";
import { PreviewPanel } from "./PreviewPanel";
import { StoryProgressPanel } from "./StoryProgressPanel";
import { CartoonWorkflowNav, type CartoonWorkflowTab } from "./CartoonWorkflowNav";
import { StoryInfoPage } from "./StoryInfoPage";
import { EpisodesPage } from "./EpisodesPage";
import { CartoonPublishPage } from "./CartoonPublishPage";
import { LANGUAGES, GENRES } from "../../../lib/genres";
import { getContentTypeForPublish, resolveSelectedContentType, needsLegacyProviderRepair, attachCoverToStoryline, derivePublishTitle, shouldBlockDuplicatePlotPublish, isRawFilenameTitle, hasExplicitEpisodeTitle, isPreflightBlocked, formatPreflightBlock } from "../lib/publish-helpers";
import { verifyPublicCartoonTitle, publicTitleWarning } from "../lib/verify-public-title";
import { isCodexAuthUnclear, CODEX_AUTH_UNCLEAR_MESSAGE, type AgentReadiness } from "@app-lib/agent-readiness";
import { cartoonGenesisReadiness } from "@app-lib/cartoon-readiness";

interface StoriesPageProps {
  token: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
}

const STORAGE_KEY = "plotlink-panel-ratio";
const DEFAULT_RATIO = 0.6; // terminal gets 60% of available space
const MIN_PANEL_PX = 300;
const SIDEBAR_PX = 224; // w-56
const HANDLE_PX = 6;

function loadRatio(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) {
      const n = parseFloat(v);
      if (n > 0 && n < 1) return n;
    }
  } catch { /* ignore */ }
  return DEFAULT_RATIO;
}

function clampRatio(r: number, available: number): number {
  if (available <= 0) return r;
  const minR = MIN_PANEL_PX / available;
  const maxR = 1 - MIN_PANEL_PX / available;
  if (minR >= maxR) return 0.5; // panels can't both fit, split evenly
  return Math.min(maxR, Math.max(minR, r));
}

export function StoriesPage({ token, authFetch }: StoriesPageProps) {
  const [selectedStory, setSelectedStory] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // Cartoon right-panel workflow nav (#439): a non-file workflow page is open
  // (Story Info / Episodes). null ⇒ the view follows selectedFile (or Progress).
  const [cartoonView, setCartoonView] = useState<"story-info" | "episodes" | "publish" | null>(null);
  const [publishingFile, setPublishingFile] = useState<string | null>(null);
  const [publishProgress, setPublishProgress] = useState<string>("");
  // Durable publish blocker (#375): unlike the transient publishProgress text,
  // this stays visible until the writer dismisses it or starts a new publish, so
  // an insufficient-balance preflight block doesn't silently vanish.
  const [publishError, setPublishError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [ratio, setRatio] = useState(loadRatio);
  const [untitledSessions, setUntitledSessions] = useState<string[]>([]);
  const [showNewStoryModal, setShowNewStoryModal] = useState(false);
  const [newStoryTitle, setNewStoryTitle] = useState("");
  const [newStoryDescription, setNewStoryDescription] = useState("");
  const [newStoryGenre, setNewStoryGenre] = useState("");
  const [newStoryLanguage, setNewStoryLanguage] = useState("English");
  const [newStoryAgentMode, setNewStoryAgentMode] = useState<"normal" | "bypass">("normal");
  const [newStoryAgentProvider, setNewStoryAgentProvider] = useState<"claude" | "codex">("claude");
  const [readiness, setReadiness] = useState<AgentReadiness | null>(null);
  const [codexEnableCopied, setCodexEnableCopied] = useState(false);
  const [bypassStories, setBypassStories] = useState<Record<string, boolean>>({});
  const [agentProviders, setAgentProviders] = useState<Record<string, "claude" | "codex">>({});
  // Track confirmed stories (those with structure.md) for Archive gating
  const [confirmedStories, setConfirmedStories] = useState<Set<string>>(new Set());
  // Stories that already have a genesis.md — so the outline footer can suggest
  // reviewing Genesis rather than writing it again (#422).
  const [genesisStories, setGenesisStories] = useState<Set<string>>(new Set());
  const [storyContentTypes, setStoryContentTypes] = useState<Record<string, "fiction" | "cartoon">>({});
  // `undefined` ⇒ language couldn't be determined for the story → the publish
  // panel shows "Needs metadata" rather than defaulting to English (#424).
  const [storyLanguages, setStoryLanguages] = useState<Record<string, string | undefined>>({});
  // Publish metadata from .story.json (#424) so the publish controls seed real
  // values. `undefined` ⇒ not set in .story.json → client shows "Needs metadata".
  const [storyGenres, setStoryGenres] = useState<Record<string, string | undefined>>({});
  const [storyNsfw, setStoryNsfw] = useState<Record<string, boolean | undefined>>({});
  const [storyTitles, setStoryTitles] = useState<Record<string, string>>({});
  // Provider recorded on each persisted story (read-only, from /api/stories).
  // Absent ⇒ legacy story with no provider (defaults to Claude at launch).
  const [storyProviders, setStoryProviders] = useState<Record<string, "claude" | "codex" | undefined>>({});
  const contentTypeMap = useRef<Map<string, "fiction" | "cartoon">>(new Map());
  const languageMap = useRef<Map<string, string>>(new Map());
  const agentModeMap = useRef<Map<string, "normal" | "bypass">>(new Map());
  const agentProviderMap = useRef<Map<string, "claude" | "codex">>(new Map());
  const knownStoriesRef = useRef<Set<string>>(new Set());
  const renameRef = useRef<((oldName: string, newName: string, meta?: { contentType?: "fiction" | "cartoon"; language?: string; agentMode?: "normal" | "bypass"; agentProvider?: "claude" | "codex" }) => Promise<boolean>) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Fetch wallet address for edit panel authorship check
  useEffect(() => {
    authFetch("/api/wallet")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data?.address) setWalletAddress(data.address); })
      .catch(() => {});
  }, [authFetch]);

  // Best-effort agent-readiness probe for cartoon-mode guidance. Failures leave
  // readiness null (no warning shown); this never blocks fiction or cartoon.
  useEffect(() => {
    authFetch("/api/agent/readiness")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setReadiness(data); })
      .catch(() => {});
  }, [authFetch]);

  // Persist ratio to localStorage
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(ratio)); } catch { /* ignore */ }
  }, [ratio]);

  // Clamp ratio on window resize so panels stay above MIN_PANEL_PX
  useEffect(() => {
    const onResize = () => {
      if (!containerRef.current) return;
      const available = containerRef.current.getBoundingClientRect().width - SIDEBAR_PX - HANDLE_PX;
      setRatio((prev) => clampRatio(prev, available));
    };
    window.addEventListener("resize", onResize);
    // Also clamp on mount in case stored ratio is out of range for current window
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleNewStory = useCallback(() => {
    setNewStoryTitle("");
    setNewStoryDescription("");
    setNewStoryGenre("");
    setNewStoryAgentMode("normal");
    setNewStoryAgentProvider("claude");
    setShowNewStoryModal(true);
  }, []);

  // Guided New Story (#423): create the named story up front from the chosen
  // title/metadata (server writes .story.json + CLAUDE.md), then land on the
  // story progress overview (#418) so the user sees what's next + a copy-paste
  // first prompt — no need to ask the agent to rename an "Untitled" project.
  const handleCreateStory = useCallback(async (contentType: "fiction" | "cartoon", language: string, agentMode: "normal" | "bypass", agentProvider: "claude" | "codex") => {
    const title = newStoryTitle.trim();
    if (!title) return; // guarded by the disabled Create buttons
    const provider = contentType === "cartoon" ? "codex" : agentProvider;
    try {
      const res = await authFetch("/api/stories/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: newStoryDescription.trim() || undefined,
          language,
          genre: newStoryGenre || undefined,
          contentType,
          agentMode,
          agentProvider: provider,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setShowNewStoryModal(false);
      // Prime the client maps so gating/labels are right before the next poll.
      setStoryContentTypes((prev) => ({ ...prev, [data.name]: contentType }));
      setStoryLanguages((prev) => ({ ...prev, [data.name]: language }));
      if (newStoryGenre) setStoryGenres((prev) => ({ ...prev, [data.name]: newStoryGenre }));
      setAgentProviders((prev) => ({ ...prev, [data.name]: provider }));
      if (agentMode === "bypass") setBypassStories((prev) => ({ ...prev, [data.name]: true }));
      // Land on the progress overview for the named story.
      setSelectedStory(data.name);
      setSelectedFile(null);
    } catch { /* leave the modal open on failure */ }
  }, [authFetch, newStoryTitle, newStoryDescription, newStoryGenre]);

  // Poll for new stories and auto-transition untitled sessions
  useEffect(() => {
    if (untitledSessions.length === 0) return;
    const interval = setInterval(async () => {
      try {
        const res = await authFetch("/api/stories");
        if (!res.ok) return;
        const data = await res.json();
        const currentNames = new Set<string>(
          (data.stories as { name: string }[])
            .filter((s) => s.name !== "_example")
            .map((s) => s.name)
        );
        // Detect newly appeared stories
        for (const name of currentNames) {
          if (!knownStoriesRef.current.has(name) && untitledSessions.length > 0) {
            // New story appeared — rename the oldest untitled session to the story name
            const oldName = untitledSessions[0];
            // Read the pending session's metadata BEFORE the rename so it can be
            // persisted atomically with the rename server-side (#295).
            const ct = contentTypeMap.current.get(oldName) || "fiction";
            const lang = languageMap.current.get(oldName) || "English";
            const mode = agentModeMap.current.get(oldName) || "normal";
            const provider = agentProviderMap.current.get(oldName) || "claude";
            let renamed = false;
            if (renameRef.current) {
              renamed = await renameRef.current(oldName, name, {
                contentType: ct, language: lang, agentMode: mode, agentProvider: provider,
              }).catch(() => false);
            }
            if (renamed) {
              setUntitledSessions((prev) => prev.slice(1));
              contentTypeMap.current.delete(oldName);
              languageMap.current.delete(oldName);
              agentModeMap.current.delete(oldName);
              agentProviderMap.current.delete(oldName);
              if (mode === "bypass") {
                setBypassStories((prev) => {
                  const next = { ...prev, [name]: true };
                  delete next[oldName];
                  return next;
                });
              }
              setAgentProviders((prev) => {
                const next = { ...prev, [name]: provider };
                delete next[oldName];
                return next;
              });
              authFetch(`/api/stories/${name}/metadata`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contentType: ct, language: lang, agentMode: mode, agentProvider: provider }),
              }).catch(() => {});
            }
            setSelectedStory(name);
            setSelectedFile(null);
          }
        }
        knownStoriesRef.current = currentNames;
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [authFetch, untitledSessions]);

  // Initialize known stories on mount
  useEffect(() => {
    authFetch("/api/stories").then((res) => {
      if (res.ok) return res.json();
    }).then((data) => {
      if (data?.stories) {
        knownStoriesRef.current = new Set(
          (data.stories as { name: string }[])
            .filter((s) => s.name !== "_example")
            .map((s) => s.name)
        );
      }
    }).catch(() => {});
  }, [authFetch]);

  const handleSelectFile = useCallback((storyName: string, fileName: string) => {
    setSelectedStory(storyName);
    setSelectedFile(fileName);
    setCartoonView(null); // a file view supersedes a non-file workflow page
  }, []);

  const latestStoryRef = useRef<string | null>(null);

  const handleSelectStory = useCallback(async (name: string) => {
    latestStoryRef.current = name;
    setSelectedStory(name);
    setSelectedFile(null);
    setCartoonView(null);
    // Cartoon stories land on the story-level progress overview (#418). Fiction
    // PRESERVES the existing auto-open-latest-file behavior (fiction can still
    // reach the overview via the "Progress" button).
    try {
      const res = await authFetch(`/api/stories/${name}`);
      if (res.ok && latestStoryRef.current === name) {
        const data = await res.json();
        if (data.contentType === "cartoon") return; // overview
        const files: { file: string }[] = data.files || [];
        const plots = files
          .map((f) => ({ file: f.file, num: f.file.match(/^plot-(\d+)\.md$/)?.[1] }))
          .filter((p) => p.num != null)
          .sort((a, b) => parseInt(b.num!) - parseInt(a.num!));
        const latest = plots[0]?.file
          ?? (files.find((f) => f.file === "genesis.md")?.file)
          ?? (files.find((f) => f.file === "structure.md")?.file)
          ?? files[0]?.file;
        if (latest && latestStoryRef.current === name) setSelectedFile(latest);
      }
    } catch { /* ignore — stays on overview */ }
  }, [authFetch]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const available = rect.width - SIDEBAR_PX - HANDLE_PX;
      const x = ev.clientX - rect.left - SIDEBAR_PX;
      setRatio(clampRatio(x / available, available));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  const handlePublish = useCallback(async (storyName: string, fileName: string, genre: string, language: string, isNsfw: boolean, coverFile?: File | null) => {
    setPublishingFile(fileName);
    setPublishProgress("Reading file...");
    setPublishError(null); // clear any prior durable block on a fresh attempt (#375)
    let coverAttachFailed = false;
    // Durable #379 public-title verification warning, set after indexing if
    // PlotLink indexed a raw/generic public title (surfaced even though the
    // publish itself succeeded — the metadata is immutable).
    let titleVerifyWarning: string | null = null;
    // Whether the publish actually SUCCEEDED on-chain (the SSE `done` event with a
    // txHash). Returned to the caller so PreviewPanel drops the selected genesis
    // cover ONLY on a confirmed-successful publish. A publish that is blocked
    // before the stream (#375) OR opens then fails/errors before `done` (#376)
    // leaves this false, so the writer's cover stays selected for the retry.
    let succeeded = false;

    try {
      // Get file content
      const fileRes = await authFetch(`/api/stories/${storyName}/${fileName}`);
      if (!fileRes.ok) throw new Error("Failed to read file");
      const fileData = await fileRes.json();

      // Derive the publish title (#331). The storyline title is set once at
      // genesis publish and is immutable on-chain, so a headingless genesis.md
      // must not fall back to the bare "genesis" filename. For genesis, fetch
      // structure.md so its `# Title` H1 can stand in, with a prettified folder
      // slug as the last resort. Best-effort: structure.md may be absent.
      const publishContentType = storyContentTypes[storyName];
      let structureContent: string | null = null;
      let episodeTitle: string | null = null;
      if (fileName === "genesis.md") {
        try {
          const structRes = await authFetch(`/api/stories/${storyName}/structure.md`);
          if (structRes.ok) structureContent = (await structRes.json()).content ?? null;
        } catch { /* best effort — fall back to the prettified slug */ }
      } else if (publishContentType === "cartoon" && fileName.match(/^plot-\d+\.md$/)) {
        // Cartoon publish markdown is image-only (no H1), so read the cut plan's
        // episode title to avoid publishing the raw "plot-NN" filename (#347).
        try {
          const cutsRes = await authFetch(`/api/stories/${storyName}/cuts/${fileName.replace(/\.md$/, "")}`);
          if (cutsRes.ok) episodeTitle = (await cutsRes.json()).title ?? null;
        } catch { /* best effort — fall back to a friendly "Episode NN" */ }
      }
      const title = derivePublishTitle({
        fileName,
        fileContent: fileData.content,
        storySlug: storyName,
        structureContent,
        contentType: publishContentType,
        episodeTitle,
      });

      // Defense-in-depth (#358): never publish a cartoon story/episode whose
      // public title is still a raw filename label ("genesis"/"plot-NN"). The
      // publish panel already blocks this, but guard the action too.
      if (publishContentType === "cartoon" && isRawFilenameTitle(title, fileName)) {
        setPublishProgress(
          fileName === "genesis.md"
            ? "Add a real “# Title” heading to genesis.md before publishing — it would otherwise publish as a raw filename."
            : "Set an episode title in the cut plan before publishing — it would otherwise publish as a raw filename.",
        );
        setTimeout(() => { setPublishingFile(null); setPublishProgress(""); }, 6000);
        return false;
      }

      // Defense-in-depth (#365, tightened #368): a cartoon plot must have an
      // explicit reader-facing title (cut-plan title or a real H1) that is NOT a
      // generic "Episode NN"/"Chapter NN"/"plot-NN" placeholder. Block the action
      // too, not just the panel.
      if (publishContentType === "cartoon" && fileName.match(/^plot-\d+\.md$/)
        && !hasExplicitEpisodeTitle({ fileContent: fileData.content, episodeTitle })) {
        setPublishProgress(
          "Set a real episode title in the cut plan (or add a “# Title” to the episode) before publishing — a generic “Episode NN” placeholder can’t be published.",
        );
        setTimeout(() => { setPublishingFile(null); setPublishProgress(""); }, 6000);
        return false;
      }

      // Defense-in-depth (#359, hardened in #400): a cartoon Genesis is the
      // reader-facing opening, so block publish when it isn't a real story
      // opening (missing H1, synopsis/outline shape, too short, or a single dense
      // block) even if the panel guard is bypassed. Surface the specific blocker.
      if (publishContentType === "cartoon" && fileName === "genesis.md") {
        const genesisBlockers = cartoonGenesisReadiness(fileData.content).blockers;
        if (genesisBlockers.length > 0) {
          setPublishProgress(
            `Genesis is the reader-facing Story opening — fix it before publishing: ${genesisBlockers[0]}`,
          );
          setTimeout(() => { setPublishingFile(null); setPublishProgress(""); }, 6000);
          return false;
        }
      }

      // For plot files, find the storylineId from the genesis publish status
      let storylineId: number | undefined;
      if (fileName.match(/^plot-\d+\.md$/)) {
        // #332: never mint a second chainPlot for a plot that already has an
        // on-chain chapter recorded — a duplicate chainPlot creates a permanent
        // extra chapter on PlotLink. fileData carries the retained txHash/
        // plotIndex even when a later content edit reset status to "pending".
        // The published-not-indexed recovery path is exempt (handled in the
        // preview UI behind an explicit duplicate-risk confirm).
        if (shouldBlockDuplicatePlotPublish(fileData)) {
          setPublishProgress(
            "Already published on PlotLink — republishing would create a duplicate chapter. Open it on PlotLink instead (or use Retry Index if it isn't showing yet).",
          );
          setTimeout(() => { setPublishingFile(null); setPublishProgress(""); }, 6000);
          return;
        }
        try {
          const storyRes = await authFetch(`/api/stories/${storyName}`);
          if (storyRes.ok) {
            const storyData = await storyRes.json();
            const genesis = storyData.files.find((f: { file: string; storylineId?: number }) =>
              f.file === "genesis.md" && f.storylineId);
            storylineId = genesis?.storylineId;
          }
        } catch { /* ignore */ }
        if (!storylineId) {
          setPublishProgress("Error: Publish genesis first to create the storyline");
          setTimeout(() => { setPublishingFile(null); setPublishProgress(""); }, 3000);
          return false;
        }
      }

      // #375: gate on wallet balance BEFORE opening the publish stream. The
      // pilot's publish proceeded into "Broadcasting transaction..." despite
      // preflight already reporting insufficient ETH, then returned to draft with
      // no durable error. Run preflight here and, if the OWS wallet can't cover at
      // least the creation fee (or is otherwise not ready), block with a durable,
      // obvious inline error instead of calling /api/publish/file. A preflight
      // network/HTTP error is NOT treated as a block — fall through so a flaky
      // preflight can't stop an otherwise-fundable publish (the stream surfaces
      // its own error).
      setPublishProgress("Checking wallet balance...");
      try {
        const preRes = await authFetch("/api/publish/preflight");
        if (preRes.ok) {
          const pre = await preRes.json();
          if (isPreflightBlocked(pre)) {
            setPublishError(formatPreflightBlock(pre));
            setPublishingFile(null);
            setPublishProgress("");
            return false;
          }
        }
      } catch { /* preflight unreachable — don't hard-block; let the publish stream report */ }

      // Run publish flow via SSE
      setPublishProgress("Publishing...");
      const publishRes = await authFetch("/api/publish/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyName, fileName, title, content: fileData.content, genre, language, isNsfw, storylineId,
          ...(getContentTypeForPublish(storyContentTypes, storyName, storylineId) ? { contentType: getContentTypeForPublish(storyContentTypes, storyName, storylineId) } : {}),
        }),
      });

      if (!publishRes.ok) {
        const err = await publishRes.json();
        throw new Error(err.error || "Publish failed");
      }

      // Read SSE stream
      const reader = publishRes.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          const lines = text.split("\n").filter((l) => l.startsWith("data: "));
          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.step) setPublishProgress(data.message || data.step);
              if (data.step === "done" && data.txHash) {
                // Publish confirmed on-chain — the only point at which the cover
                // selection may be dropped (#376). Anything short of this (a
                // pre-stream block, a non-ok response, an error before `done`, or
                // a stream that ends without `done`) leaves `succeeded` false so
                // PreviewPanel keeps the selected/auto-detected cover for retry.
                succeeded = true;
                // Update publish status with gasCost
                await authFetch(`/api/stories/${storyName}/${fileName}/publish-status`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    txHash: data.txHash,
                    storylineId: data.storylineId,
                    plotIndex: data.plotIndex,
                    contentCid: data.contentCid,
                    gasCost: data.gasCost,
                    indexError: data.indexError,
                    authorAddress: walletAddress,
                  }),
                });

                // Pre-publish cover (#284): a new genesis can't carry a cover
                // through createStoryline, so once the storyline exists, attach
                // the selected cover via upload-cover + update-storyline. Best-
                // effort — a failure leaves the storyline published with no
                // cover, settable later via Edit Story.
                if (coverFile && fileName === "genesis.md" && data.storylineId) {
                  setPublishProgress("Uploading cover...");
                  let coverCid: string | null = null;
                  try {
                    coverCid = await attachCoverToStoryline(authFetch, data.storylineId, coverFile);
                  } catch { /* non-fatal: storyline is already published */ }
                  // A null result means the cover was not attached (upload or
                  // update-storyline failed). The storyline is published either
                  // way; tell the user so they can retry from Edit Story.
                  if (!coverCid) coverAttachFailed = true;
                }

                // #379: end-to-end public-title verification. Local guards ensure
                // OWS sends a reader-facing title, but the pilot showed PlotLink
                // can still index a raw "genesis"/"plot-NN" title. There is no
                // public JSON read endpoint, so an OWS server route reads the
                // rendered public page's og:title (no CORS) and returns the
                // indexed title; verify it here. Inconclusive reads (page
                // unreachable / no title) never warn — only a confirmed
                // raw/generic public title does. The publish is already on-chain +
                // immutable, so this can only warn.
                if (publishContentType === "cartoon" && data.storylineId) {
                  try {
                    const isPlot = fileName !== "genesis.md";
                    const q = `storylineId=${data.storylineId}` +
                      (isPlot && data.plotIndex != null ? `&plotIndex=${data.plotIndex}` : "");
                    const pubRes = await authFetch(`/api/publish/public-title?${q}`);
                    if (pubRes.ok) {
                      const pub = await pubRes.json();
                      const detail = isPlot
                        ? { plots: pub.plotTitle != null ? [{ plotIndex: data.plotIndex, title: pub.plotTitle }] : [] }
                        : { title: pub.storylineTitle };
                      const verdict = verifyPublicCartoonTitle({ fileName, detail, plotIndex: data.plotIndex });
                      if (!verdict.ok) titleVerifyWarning = publicTitleWarning(verdict);
                    }
                  } catch { /* inconclusive — don't false-warn on a read failure */ }
                }
              }
            } catch { /* ignore partial SSE */ }
          }
        }
      }

      // A failed public-title verification (#379) is a durable warning that
      // outranks the transient "Published!" line — the metadata is immutable, so
      // the writer must know the next publish needs corrected metadata.
      if (titleVerifyWarning) setPublishError(titleVerifyWarning);
      setPublishProgress(
        coverAttachFailed
          ? "Published, but cover upload failed — set it later from Edit Story."
          : "Published!",
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed";
      setPublishProgress(`Error: ${message}`);
    } finally {
      setTimeout(() => {
        setPublishingFile(null);
        setPublishProgress("");
      }, 3000);
    }
    // Tell PreviewPanel whether it may drop the selected cover. Clear ONLY when
    // the publish is confirmed on-chain AND the cover was actually attached:
    // - pre-stream block (#375) or failed/aborted publish (#376) → succeeded false → keep,
    // - published on-chain but the cover upload/attach failed (#376/re1) →
    //   coverAttachFailed true → keep, so the writer doesn't silently lose the
    //   cover that never made it onto the storyline (settable via Edit Story).
    // A publish with no selected cover (coverAttachFailed stays false) clears as
    // before once it succeeds.
    return succeeded && !coverAttachFailed;
  }, [authFetch, storyContentTypes, walletAddress]);

  const handleDestroySession = useCallback((name: string) => {
    if (name.startsWith("_new_")) {
      setUntitledSessions((prev) => prev.filter((id) => id !== name));
      contentTypeMap.current.delete(name);
      languageMap.current.delete(name);
      agentModeMap.current.delete(name);
      agentProviderMap.current.delete(name);
      setBypassStories((prev) => {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setAgentProviders((prev) => {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const updateFromStories = (stories: { name: string; title?: string | null; hasStructure: boolean; hasGenesis?: boolean; contentType?: "fiction" | "cartoon"; language?: string; genre?: string; isNsfw?: boolean; agentProvider?: "claude" | "codex" }[]) => {
      setConfirmedStories(new Set(stories.filter((s) => s.hasStructure).map((s) => s.name)));
      setGenesisStories(new Set(stories.filter((s) => s.hasGenesis).map((s) => s.name)));
      const ct: Record<string, "fiction" | "cartoon"> = {};
      const lang: Record<string, string | undefined> = {};
      const genre: Record<string, string | undefined> = {};
      const nsfw: Record<string, boolean | undefined> = {};
      const prov: Record<string, "claude" | "codex" | undefined> = {};
      const titles: Record<string, string> = {};
      for (const s of stories) {
        ct[s.name] = s.contentType || "fiction";
        // Preserve absence (vs. defaulting to English/Romance) so the publish
        // panel can tell "set to X" from "not set yet" and show Needs metadata (#424).
        lang[s.name] = s.language;
        genre[s.name] = s.genre;
        nsfw[s.name] = s.isNsfw;
        prov[s.name] = s.agentProvider;
        if (s.title) titles[s.name] = s.title;
      }
      setStoryContentTypes(ct);
      setStoryLanguages(lang);
      setStoryGenres(genre);
      setStoryNsfw(nsfw);
      setStoryProviders(prov);
      setStoryTitles(titles);
    };
    authFetch("/api/stories").then((res) => res.ok ? res.json() : null).then((data) => {
      if (data?.stories) updateFromStories(data.stories);
    }).catch(() => {});
    const interval = setInterval(async () => {
      try {
        const res = await authFetch("/api/stories");
        if (res.ok) {
          const data = await res.json();
          updateFromStories(data.stories);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [authFetch]);

  // Codex readiness for cartoon gating. `codexReady` requires Codex installed
  // AND image_generation effectively enabled. `cartoonBlocked` only disables
  // create once readiness has actually loaded and is not ready — when readiness
  // is still null (loading or probe-endpoint failure) we DO NOT block, to avoid
  // permanently bricking cartoon if the probe errors.
  const codexReady =
    !!readiness && readiness.codex.installed && readiness.codex.imageGeneration === "enabled";
  const cartoonBlocked = !!readiness && !codexReady;

  const copyCodexEnable = useCallback(async () => {
    try {
      await navigator.clipboard.writeText("codex features enable image_generation");
      setCodexEnableCopied(true);
      setTimeout(() => setCodexEnableCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }, []);

  // Explicit, scoped repair for a legacy cartoon story with no recorded
  // provider: set THIS story's `agentProvider` to "codex". Reuses the metadata
  // route, whose `...existing` spread preserves language/agentMode. Does NOT
  // touch fiction, does NOT bulk-migrate. Optimistically updates local provider
  // state so launch gating sees codex immediately, then re-fetches.
  const handleRepairProvider = useCallback(async () => {
    if (!selectedStory || selectedStory.startsWith("_new_")) return;
    const name = selectedStory;
    const res = await authFetch(`/api/stories/${name}/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "cartoon", agentProvider: "codex" }),
    });
    if (!res.ok) return;
    setStoryProviders((prev) => ({ ...prev, [name]: "codex" }));
    setAgentProviders((prev) => ({ ...prev, [name]: "codex" }));
    // Re-fetch so the list state reflects the persisted provider.
    try {
      const listRes = await authFetch("/api/stories");
      if (listRes.ok) {
        const data = await listRes.json();
        if (data?.stories) {
          const prov: Record<string, "claude" | "codex" | undefined> = {};
          for (const s of data.stories as { name: string; agentProvider?: "claude" | "codex" }[]) {
            prov[s.name] = s.agentProvider;
          }
          setStoryProviders(prov);
        }
      }
    } catch { /* ignore */ }
  }, [authFetch, selectedStory]);

  const handleArchiveStory = useCallback((name: string) => {
    // Archive API already called by TerminalPanel — just clear selection
    if (selectedStory === name) {
      setSelectedStory(null);
      setSelectedFile(null);
    }
  }, [selectedStory]);

  // Resolve the effective provider for the selected story: an optimistic/new
  // session value (agentProviders) wins, else the persisted list value.
  const selectedProvider = selectedStory
    ? (agentProviders[selectedStory] ?? storyProviders[selectedStory])
    : undefined;
  const selectedContentType = resolveSelectedContentType(selectedStory, storyContentTypes, contentTypeMap.current);
  const selectedNeedsProviderRepair = needsLegacyProviderRepair(
    selectedContentType,
    selectedProvider,
    selectedStory,
  );

  // Cartoon-only right-panel workflow nav (#439). The active tab follows the
  // open non-file view (Story Info / Episodes) or the closest file: structure.md
  // ⇒ Whitepaper, genesis.md ⇒ Genesis / Ep 1, plot-NN ⇒ Episodes, else Progress.
  const isCartoonStory = !!selectedStory && selectedContentType === "cartoon";
  const activeCartoonTab: CartoonWorkflowTab =
    cartoonView === "story-info" ? "story-info"
    : cartoonView === "episodes" ? "episodes"
    : cartoonView === "publish" ? "publish"
    : selectedFile === "structure.md" ? "whitepaper"
    : selectedFile === "genesis.md" ? "genesis"
    : selectedFile && /^plot-\d+\.md$/.test(selectedFile) ? "episodes"
    : "progress";

  const handleCartoonNav = useCallback((tab: CartoonWorkflowTab) => {
    // Use the current selected story, not latestStoryRef — that ref is only set
    // by handleSelectStory, so opening another story's file via the LEFT tree
    // (handleSelectFile) would leave it stale and route file tabs to the wrong
    // story (#445 RE1). `selectedStory` always reflects the visible story.
    const story = selectedStory;
    if (!story) return;
    switch (tab) {
      case "progress": setCartoonView(null); setSelectedFile(null); break;
      case "story-info": setCartoonView("story-info"); break;
      case "episodes": setCartoonView("episodes"); break;
      case "whitepaper": handleSelectFile(story, "structure.md"); break;
      case "genesis": handleSelectFile(story, "genesis.md"); break;
      // Publish opens its own readiness page and stays on the Publish tab (#449),
      // instead of visually routing to the Genesis file view.
      case "publish": setCartoonView("publish"); break;
    }
  }, [selectedStory, handleSelectFile]);

  // Keep the publish-control seeds in sync after a Story Info save (#439).
  const handleStoryInfoSaved = useCallback((patch: { genre?: string; language?: string; isNsfw?: boolean }) => {
    if (!selectedStory) return;
    if (patch.genre !== undefined) setStoryGenres((prev) => ({ ...prev, [selectedStory]: patch.genre || undefined }));
    if (patch.language !== undefined) setStoryLanguages((prev) => ({ ...prev, [selectedStory]: patch.language || undefined }));
    if (patch.isNsfw !== undefined) setStoryNsfw((prev) => ({ ...prev, [selectedStory]: patch.isNsfw }));
  }, [selectedStory]);

  return (
    <div ref={containerRef} className="h-[calc(100vh-3.5rem)] flex">
      {/* Story Browser Sidebar */}
      <div className="w-56 border-r border-border flex-shrink-0">
        <StoryBrowser
          authFetch={authFetch}
          selectedStory={selectedStory}
          selectedFile={selectedFile}
          onSelectFile={handleSelectFile}
          onNewStory={handleNewStory}
          untitledSessions={untitledSessions}
        />
      </div>

      {/* Terminal — sized by ratio of available space */}
      <div className="min-w-0 border-r border-border" style={{ flex: `${ratio} 0 0` }}>
        <TerminalPanel token={token} storyName={selectedStory} authFetch={authFetch} onSelectStory={handleSelectStory} onDestroySession={handleDestroySession} onArchiveStory={handleArchiveStory} confirmedStories={confirmedStories} renameRef={renameRef} bypassStories={bypassStories} agentProviders={agentProviders} readiness={readiness} contentType={resolveSelectedContentType(selectedStory, storyContentTypes, contentTypeMap.current)} needsProviderRepair={selectedNeedsProviderRepair} onRepairProvider={handleRepairProvider} />
      </div>

      {/* Drag Handle */}
      <div
        onMouseDown={handleMouseDown}
        className="flex-shrink-0 flex items-center justify-center hover:bg-border/50 transition-colors"
        style={{ width: HANDLE_PX, cursor: "col-resize", background: "var(--border)" }}
      >
        <div className="flex flex-col gap-1">
          <div className="w-0.5 h-0.5 rounded-full" style={{ background: "var(--text-muted)" }} />
          <div className="w-0.5 h-0.5 rounded-full" style={{ background: "var(--text-muted)" }} />
          <div className="w-0.5 h-0.5 rounded-full" style={{ background: "var(--text-muted)" }} />
        </div>
      </div>

      {/* Preview — takes remaining space. With a story but no file selected, show
          the story-level progress overview (#418) instead of the empty state. */}
      <div className="min-w-0 flex flex-col" style={{ flex: `${1 - ratio} 0 0` }}>
        {/* Cartoon workflow nav (#439) — persistent above the right-panel content. */}
        {isCartoonStory && selectedStory && (
          <CartoonWorkflowNav
            storyTitle={storyTitles[selectedStory] || selectedStory}
            active={activeCartoonTab}
            onSelect={handleCartoonNav}
          />
        )}
        {isCartoonStory && cartoonView === "story-info" && selectedStory ? (
          <StoryInfoPage storyName={selectedStory} authFetch={authFetch} onSaved={handleStoryInfoSaved} />
        ) : isCartoonStory && cartoonView === "episodes" && selectedStory ? (
          <EpisodesPage storyName={selectedStory} authFetch={authFetch} onOpenFile={handleSelectFile} />
        ) : isCartoonStory && cartoonView === "publish" && selectedStory ? (
          <CartoonPublishPage storyName={selectedStory} authFetch={authFetch} onOpenFile={handleSelectFile} onOpenStoryInfo={() => setCartoonView("story-info")} />
        ) : selectedStory && !selectedFile ? (
          <StoryProgressPanel
            storyName={selectedStory}
            authFetch={authFetch}
            onOpenFile={handleSelectFile}
          />
        ) : (
        <PreviewPanel
          storyName={selectedStory}
          fileName={selectedFile}
          authFetch={authFetch}
          onPublish={handlePublish}
          publishingFile={publishingFile}
          walletAddress={walletAddress}
          contentType={resolveSelectedContentType(selectedStory, storyContentTypes, contentTypeMap.current) || "fiction"}
          language={selectedStory ? storyLanguages[selectedStory] : undefined}
          genre={selectedStory ? storyGenres[selectedStory] : undefined}
          isNsfw={selectedStory ? storyNsfw[selectedStory] : undefined}
          hasGenesis={selectedStory ? genesisStories.has(selectedStory) : false}
          onViewProgress={() => setSelectedFile(null)}
          onOpenFile={(file) => selectedStory && handleSelectFile(selectedStory, file)}
        />
        )}
        {publishProgress && (
          <div className="px-3 py-1.5 bg-surface border-t border-border text-xs text-muted">
            {publishProgress}
          </div>
        )}
        {/* Durable publish blocker (#375) — stays until dismissed or the next
            publish attempt, so an insufficient-balance block is obvious and
            doesn't disappear on a timer. */}
        {publishError && (
          <div
            className="px-3 py-2 bg-error/10 border-t border-error/40 text-xs text-error flex items-start justify-between gap-3"
            data-testid="publish-block-error"
            role="alert"
          >
            <span>{publishError}</span>
            <button
              type="button"
              onClick={() => setPublishError(null)}
              className="shrink-0 text-error/70 hover:text-error underline"
              data-testid="publish-block-error-dismiss"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {showNewStoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(240, 235, 225, 0.9)" }}>
          <div className="bg-surface border border-border rounded-lg shadow-lg p-6 max-w-sm w-full space-y-4">
            <h3 className="text-sm font-serif font-medium text-foreground text-center">New Story</h3>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-muted">Title <span className="text-accent">*</span></span>
              <input
                type="text"
                value={newStoryTitle}
                onChange={(e) => setNewStoryTitle(e.target.value)}
                placeholder="e.g. 신의 세포"
                data-testid="new-story-title"
                className="w-full px-2 py-1.5 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-muted">Short description (optional)</span>
              <input
                type="text"
                value={newStoryDescription}
                onChange={(e) => setNewStoryDescription(e.target.value)}
                placeholder="One line about the story"
                data-testid="new-story-description"
                className="w-full px-2 py-1.5 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-muted">Genre (optional)</span>
              <select
                value={newStoryGenre}
                onChange={(e) => setNewStoryGenre(e.target.value)}
                data-testid="new-story-genre"
                className="w-full px-2 py-1.5 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
              >
                <option value="">— Select later —</option>
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-muted">Language</span>
              <select
                value={newStoryLanguage}
                onChange={(e) => setNewStoryLanguage(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
              >
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-muted">Agent mode</span>
              <select
                value={newStoryAgentMode}
                onChange={(e) => setNewStoryAgentMode(e.target.value as "normal" | "bypass")}
                className="w-full px-2 py-1.5 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                data-testid="agent-mode-select"
              >
                <option value="normal">Normal (approve each action)</option>
                <option value="bypass">Permissions Bypass (advanced)</option>
              </select>
              {newStoryAgentMode === "bypass" && (
                <p className="text-[10px] text-amber-700" data-testid="agent-mode-warning">
                  Less safe: Claude can run actions without per-command approval.
                </p>
              )}
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-muted">Provider</span>
              <select
                value={newStoryAgentProvider}
                onChange={(e) => setNewStoryAgentProvider(e.target.value as "claude" | "codex")}
                className="w-full px-2 py-1.5 text-xs border border-border rounded bg-transparent focus:border-accent focus:outline-none"
                data-testid="agent-provider-select"
              >
                <option value="claude">🤖 Claude (default)</option>
                <option value="codex">🎨 Codex</option>
              </select>
              <p className="text-[10px] text-muted" data-testid="agent-provider-helper">
                {newStoryAgentProvider === "codex"
                  ? "Codex can generate clean cartoon images directly in the terminal."
                  : "Claude prepares image prompts; you generate and upload clean images externally."}
              </p>
            </label>
            <p className="text-xs text-muted text-center">Choose a content type to create</p>
            {!newStoryTitle.trim() && (
              <p className="text-[10px] text-amber-700 text-center" data-testid="new-story-title-required">Enter a title to create your story.</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleCreateStory("fiction", newStoryLanguage, newStoryAgentMode, newStoryAgentProvider)}
                disabled={!newStoryTitle.trim()}
                data-testid="create-fiction"
                className="border border-border rounded-lg p-4 hover:border-accent hover:bg-accent/5 transition-colors text-center space-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-transparent"
              >
                <p className="text-sm font-serif font-medium text-foreground">Fiction</p>
                <p className="text-[11px] text-muted">Novels, short stories, poetry</p>
              </button>
              <div className="space-y-1">
                <button
                  onClick={() => handleCreateStory("cartoon", newStoryLanguage, newStoryAgentMode, "codex")}
                  disabled={cartoonBlocked || !newStoryTitle.trim()}
                  data-testid="create-cartoon"
                  className="w-full border border-border rounded-lg p-4 hover:border-accent hover:bg-accent/5 transition-colors text-center space-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-transparent"
                >
                  <p className="text-sm font-serif font-medium text-foreground">Cartoon</p>
                  <p className="text-[11px] text-muted">Comics, manga, webtoons</p>
                  <p className="text-[11px] text-muted" data-testid="cartoon-codex-note">
                    Cartoon mode requires Codex because the clean-image step needs image generation support.
                  </p>
                </button>
                {/* Warnings/copy live OUTSIDE the button: a disabled button would
                    otherwise swallow clicks on the Copy control. */}
                {readiness && !readiness.codex.installed && (
                  <p
                    className="text-[11px] text-amber-700 text-left"
                    data-testid="cartoon-codex-warning"
                  >
                    Codex was not detected. Install the Codex CLI and sign in
                    (e.g. <span className="font-mono">npm i -g @openai/codex</span> then{" "}
                    <span className="font-mono">codex login</span>) to create cartoons.
                  </p>
                )}
                {isCodexAuthUnclear(readiness) && (
                  <p
                    className="text-[11px] text-amber-700 text-left"
                    data-testid="cartoon-codex-auth-unknown"
                  >
                    {CODEX_AUTH_UNCLEAR_MESSAGE}
                  </p>
                )}
                {readiness &&
                  readiness.codex.installed &&
                  !isCodexAuthUnclear(readiness) &&
                  readiness.codex.imageGeneration !== "enabled" && (
                    <div data-testid="cartoon-codex-warning">
                      <p className="text-[11px] text-amber-700 text-left">
                        Codex is installed but image generation isn&apos;t enabled.
                        Enable it, then reopen this dialog:
                      </p>
                      <div className="mt-1 flex items-center gap-1">
                        <code className="flex-1 truncate rounded border border-border bg-surface px-1.5 py-1 text-left text-[10px] font-mono text-foreground">
                          codex features enable image_generation
                        </code>
                        <button
                          type="button"
                          data-testid="copy-codex-enable"
                          onClick={copyCodexEnable}
                          className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:border-accent hover:text-accent transition-colors"
                        >
                          {codexEnableCopied ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            </div>
            <button
              onClick={() => setShowNewStoryModal(false)}
              className="w-full px-3 py-1.5 text-xs text-muted hover:text-foreground hover:bg-surface rounded text-center"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
