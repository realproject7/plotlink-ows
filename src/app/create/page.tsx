"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import { useAccount } from "wagmi";
import { useSearchParams } from "next/navigation";
import { useDraft } from "../../hooks/useDraft";
import { useQuery } from "@tanstack/react-query";
import {
  validateContentLength,
  MIN_CONTENT_LENGTH,
  MAX_CONTENT_LENGTH,
} from "../../../lib/content";
import { usePublish, type PublishState } from "../../hooks/usePublish";
import { useChainPlot } from "../../hooks/useChainPlot";
import { usePublishIntent } from "../../hooks/usePublishIntent";
import { RecoveryBanner } from "../../components/RecoveryBanner";
import { DEADLINE_MS } from "../../components/DeadlineCountdown";
import { storyFactoryAbi, storylineCreatedEvent } from "../../../lib/contracts/abi";
import { STORY_FACTORY, MCV2_BOND } from "../../../lib/contracts/constants";
import { supabase, type Storyline } from "../../../lib/supabase";
import { browserClient as publicClient } from "../../../lib/rpc";
import { decodeEventLog, encodeEventTopics, formatEther } from "viem";
import Link from "next/link";
import { ConnectWallet } from "../../components/ConnectWallet";
import { DropdownSelect } from "../../components/DropdownSelect";
import { Select } from "../../components/Select";
import { GENRES, LANGUAGES } from "../../../lib/genres";
import { WritePreviewToggle, ContentPreview } from "../../components/StoryContent";

const genreOptions = [
  { value: "", label: "Select genre..." },
  ...GENRES.map((g) => ({ value: g, label: g })),
];
const languageOptions = LANGUAGES.map((l) => ({ value: l, label: l }));

const STORYLINE_CREATED_TOPIC = encodeEventTopics({
  abi: [storylineCreatedEvent],
  eventName: "StorylineCreated",
})[0];

const STATE_LABELS: Record<PublishState, string> = {
  idle: "",
  uploading: "Uploading to IPFS...",
  confirming: "Confirm in wallet...",
  pending: "Publishing to Base...",
  indexing: "Indexing...",
  published: "Published!",
  error: "Error",
};

type Tab = "new" | "chain";

async function fetchWriterStorylines(address: string): Promise<Storyline[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("storylines")
    .select("*")
    .eq("writer_address", address.toLowerCase())
    .eq("hidden", false)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .order("block_timestamp", { ascending: false })
    .returns<Storyline[]>();
  return data ?? [];
}

function isStorylineExpired(s: Storyline): boolean {
  if (s.sunset) return true;
  if (!s.has_deadline) return false;
  if (!s.last_plot_time) return false;
  return Date.now() > new Date(s.last_plot_time).getTime() + DEADLINE_MS;
}

export default function CreatePageWrapper() {
  return (
    <Suspense>
      <CreatePage />
    </Suspense>
  );
}

function CreatePage() {
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();

  // Tab selection from query params
  const initialTab: Tab =
    searchParams.get("tab") === "chain" || searchParams.get("storyline")
      ? "chain"
      : "new";
  const [tab, setTab] = useState<Tab>(initialTab);

  // ---- New Storyline state ----
  const [newTitle, setNewTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [language, setLanguage] = useState("English");
  const [newContent, setNewContent] = useState("");
  const [newPreviewTab, setNewPreviewTab] = useState<"write" | "preview">("write");
  const hasDeadline = true;

  const { data: creationFee = BigInt(0) } = useQuery({
    queryKey: ["mcv2-creation-fee"],
    queryFn: async () => {
      const fee = await publicClient.readContract({
        address: MCV2_BOND,
        abi: [{ type: "function", name: "creationFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const,
        functionName: "creationFee",
      });
      return fee;
    },
    staleTime: 60_000,
  });

  const { state: newState, error: newError, receipt, execute } = usePublish();
  const {
    pendingIntent: newPendingIntent,
    saveIntent: newSaveIntent,
    persistTxHash: newPersistTxHash,
    clearIntent: newClearIntent,
    attemptRetry: newAttemptRetry,
  } = usePublishIntent();
  const { valid: newValid, charCount: newCharCount } = validateContentLength(newContent);
  const MAX_TITLE_LENGTH = 60;
  const newTitleValid = newTitle.trim().length > 0 && newTitle.length <= MAX_TITLE_LENGTH;
  const newGenreValid = genre.length > 0;
  const newCanSubmit =
    newState === "idle" || newState === "error"
      ? newTitleValid && newGenreValid && newValid
      : false;
  const newBusy = newState !== "idle" && newState !== "error";

  // ---- New Storyline draft auto-save ----
  const newDraftValues = useMemo(
    () => ({ title: newTitle, content: newContent, genre, language }),
    [newTitle, newContent, genre, language],
  );
  const newDraftSetters = useMemo(
    () => ({
      title: setNewTitle,
      content: setNewContent,
      genre: setGenre,
      language: setLanguage,
    }),
    [],
  );
  const {
    restored: newDraftRestored,
    clearDraft: clearNewDraft,
    discardDraft: discardNewDraft,
  } = useDraft("plotlink_draft_create", newDraftValues, newDraftSetters);

  // ---- Chain Plot state ----
  const prefillStoryline = searchParams.get("storyline");
  const [chainStorylineId, setChainStorylineId] = useState<number | null>(
    prefillStoryline ? Number(prefillStoryline) : null,
  );
  const [chainTitle, setChainTitle] = useState("");
  const [chainContent, setChainContent] = useState("");
  const [chainPreviewTab, setChainPreviewTab] = useState<"write" | "preview">("write");

  const { data: storylines = [], isLoading: loadingStorylines } = useQuery({
    queryKey: ["writer-active-storylines", address],
    queryFn: () => fetchWriterStorylines(address!),
    enabled: isConnected && !!address,
  });

  const {
    pendingIntent: chainPendingIntent,
    saveIntent: chainSaveIntent,
    persistTxHash: chainPersistTxHash,
    clearIntent: chainClearIntent,
    attemptRetry: chainAttemptRetry,
  } = usePublishIntent();
  const {
    state: chainState,
    error: chainError,
    chainPlot,
    reset: chainReset,
  } = useChainPlot({
    onIntentSave: chainSaveIntent,
    onTxConfirmed: chainPersistTxHash,
    onIndexed: chainClearIntent,
  });
  const { valid: chainValid, charCount: chainCharCount } = validateContentLength(chainContent);
  const chainTitleValid = chainTitle.trim().length > 0;
  const chainCanSubmit =
    (chainState === "idle" || chainState === "error") &&
    chainStorylineId !== null &&
    chainTitleValid &&
    chainValid;
  const chainBusy = chainState !== "idle" && chainState !== "error";

  // ---- Chain Plot draft auto-save ----
  const chainDraftKey = chainStorylineId
    ? `plotlink_draft_plot_${chainStorylineId}`
    : "plotlink_draft_plot";
  const chainDraftValues = useMemo(
    () => ({ title: chainTitle, content: chainContent }),
    [chainTitle, chainContent],
  );
  const chainDraftSetters = useMemo(
    () => ({ title: setChainTitle, content: setChainContent }),
    [],
  );
  const {
    restored: chainDraftRestored,
    clearDraft: clearChainDraft,
    discardDraft: discardChainDraft,
  } = useDraft(chainDraftKey, chainDraftValues, chainDraftSetters);

  // Clear drafts on successful publish (must be above early returns — Rules of Hooks)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (newState === "published") clearNewDraft(); }, [newState]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (chainState === "published") clearChainDraft(); }, [chainState]);

  if (!isConnected) {
    return (
      <div className="flex min-h-[calc(100vh-2.75rem)] flex-col items-center justify-center gap-4 px-6">
        <p className="text-muted text-sm">
          Connect your wallet to create or chain a plot.
        </p>
        <ConnectWallet />
      </div>
    );
  }

  // ---- New Storyline published state ----
  if (tab === "new" && newState === "published") {
    let newStorylineId: number | null = null;
    if (receipt) {
      const log = receipt.logs.find((l) => l.topics[0] === STORYLINE_CREATED_TOPIC);
      if (log) {
        try {
          const decoded = decodeEventLog({
            abi: storyFactoryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "StorylineCreated") {
            newStorylineId = Number(decoded.args.storylineId);
          }
        } catch { /* ignore decode errors */ }
      }
    }

    return (
      <div className="flex min-h-[calc(100vh-2.75rem)] flex-col items-center justify-center gap-6 px-6">
        <h1 className="text-accent text-2xl font-bold">Storyline created!</h1>
        <div className="flex gap-3">
          {newStorylineId != null && (
            <Link
              href={`/story/${newStorylineId}`}
              className="border-accent text-accent hover:bg-accent hover:text-background rounded border px-4 py-2 text-sm transition-colors"
            >
              View your story
            </Link>
          )}
          <Link
            href="/"
            className="border-border text-muted hover:text-foreground rounded border px-4 py-2 text-sm transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  // ---- Chain Plot published state ----
  if (tab === "chain" && chainState === "published") {
    return (
      <div className="flex min-h-[calc(100vh-2.75rem)] flex-col items-center justify-center gap-6 px-6">
        <h1 className="text-accent text-2xl font-bold">Plot chained!</h1>
        <div className="flex gap-3">
          {chainStorylineId && (
            <Link
              href={`/story/${chainStorylineId}`}
              className="border-border text-muted hover:text-foreground rounded border px-4 py-2 text-sm transition-colors"
            >
              View story
            </Link>
          )}
          <button
            onClick={chainReset}
            className="border-accent text-accent hover:bg-accent hover:text-background rounded border px-4 py-2 text-sm transition-colors"
          >
            Chain another
          </button>
        </div>
      </div>
    );
  }

  const noStoryline = chainStorylineId === null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="font-body text-2xl font-bold tracking-tight text-accent">Create</h1>

      {/* Tab bar */}
      <div className="mt-6 flex gap-2">
        <button
          onClick={() => setTab("new")}
          className={`rounded border px-3 py-1 text-xs font-medium transition-colors ${
            tab === "new"
              ? "border-accent text-accent"
              : "border-border text-muted hover:text-foreground"
          }`}
        >
          New
        </button>
        <button
          onClick={() => setTab("chain")}
          className={`rounded border px-3 py-1 text-xs font-medium transition-colors ${
            tab === "chain"
              ? "border-accent text-accent"
              : "border-border text-muted hover:text-foreground"
          }`}
        >
          Add Plot
        </button>
      </div>

      {/* ---- New Storyline Tab ---- */}
      {tab === "new" && (
        <>
          {newPendingIntent && (
            <div className="mt-6">
              <RecoveryBanner
                intent={newPendingIntent}
                onRetry={newAttemptRetry}
                onDismiss={newClearIntent}
              />
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newCanSubmit)
                execute({
                  content: newContent,
                  uploadKeyPrefix: "plotlink/genesis",
                  indexerRoute: "/api/index/storyline",
                  buildWriteCall: (cid, contentHash) => ({
                    address: STORY_FACTORY,
                    abi: storyFactoryAbi as unknown as [],
                    functionName: "createStoryline",
                    args: [newTitle.trim(), cid, contentHash, hasDeadline],
                    gas: BigInt(16_000_000),
                    value: creationFee,
                  }),
                  metadata: { genre, language },
                  onIntentSave: newSaveIntent,
                  onTxConfirmed: newPersistTxHash,
                  onIndexed: newClearIntent,
                });
            }}
            className="mt-6 space-y-6"
          >
            {newDraftRestored && (
              <div className="border-accent/30 bg-accent/5 text-accent flex items-center justify-between rounded border px-3 py-2 text-xs">
                <span>Draft restored</span>
                <button type="button" onClick={discardNewDraft} className="text-muted hover:text-error ml-2 transition-colors">
                  Discard draft
                </button>
              </div>
            )}
            {!newDraftRestored && (newTitle || newContent) && (
              <div className="flex justify-end">
                <button type="button" onClick={discardNewDraft} className="text-muted hover:text-error text-[11px] transition-colors">
                  Discard draft
                </button>
              </div>
            )}
            <div>
              <label className="text-foreground mb-2 block text-sm">Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value.slice(0, MAX_TITLE_LENGTH))}
                disabled={newBusy}
                placeholder="Enter storyline title"
                maxLength={MAX_TITLE_LENGTH}
                className="border-border bg-surface text-foreground placeholder:text-muted w-full rounded border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
              />
              <div className="mt-1 flex justify-between text-xs">
                {newTitle.length > 0 && !newTitleValid ? (
                  <span className="text-error">Title is required</span>
                ) : (
                  <span />
                )}
                <span className="text-muted">{newTitle.length} / {MAX_TITLE_LENGTH}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-foreground mb-2 block text-sm">Genre</label>
                <DropdownSelect
                  value={genre}
                  onChange={setGenre}
                  options={genreOptions}
                  placeholder="Select genre..."
                  disabled={newBusy}
                />
              </div>
              <div>
                <label className="text-foreground mb-2 block text-sm">Language</label>
                <DropdownSelect
                  value={language}
                  onChange={setLanguage}
                  options={languageOptions}
                  disabled={newBusy}
                />
              </div>
            </div>

            <div>
              <label className="text-foreground mb-1 block text-sm">Opening Chapter</label>
              <p className="text-muted mb-2 text-[11px]">
                The opening of your storyline — write a synopsis or introduction, or jump straight into the story. Markdown supported.
              </p>
              <WritePreviewToggle
                activeTab={newPreviewTab}
                onTabChange={setNewPreviewTab}
              />
              {newPreviewTab === "write" ? (
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  disabled={newBusy}
                  rows={12}
                  placeholder="Write the genesis plot (500–10,000 characters)"
                  className="ruled-paper border-border text-foreground placeholder:text-muted w-full resize-y rounded border focus:border-accent focus:outline-none disabled:opacity-50"
                />
              ) : (
                <ContentPreview content={newContent} />
              )}
              <div className="mt-1 flex justify-between text-xs">
                <span className={newContent.length > 0 && !newValid ? "text-error" : "text-muted"}>
                  {newCharCount.toLocaleString()} / {MIN_CONTENT_LENGTH.toLocaleString()}&ndash;
                  {MAX_CONTENT_LENGTH.toLocaleString()} chars
                </span>
              </div>
            </div>

            <p className="text-muted text-xs">
              All storylines have a 7-day deadline &mdash; the story sunsets if no new plot is added within 7 days.
              {creationFee > BigInt(0) && (
                <> Creation fee: {formatEther(creationFee)} ETH.</>
              )}
            </p>

            {newState === "error" && (
              <div className="border-error/30 text-error rounded border px-3 py-2 text-xs">
                {newError}
              </div>
            )}
            {newBusy && (
              <div className="border-border text-muted rounded border px-3 py-2 text-xs">
                {STATE_LABELS[newState]}
              </div>
            )}

            <div className="border-border text-muted rounded border px-3 py-2 text-[10px] leading-relaxed">
              Your content will be stored on IPFS with a content hash recorded on-chain. Once published, plots are permanently immutable and cannot be edited or deleted.
            </div>

            <button
              type="submit"
              disabled={!newCanSubmit || newBusy}
              className="border-accent text-accent hover:bg-accent hover:text-background w-full rounded border py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {newBusy ? STATE_LABELS[newState] : "Publish Storyline"}
            </button>
          </form>
        </>
      )}

      {/* ---- Add Plot Tab ---- */}
      {tab === "chain" && (
        <>
          {chainPendingIntent && (
            <div className="mt-6">
              <RecoveryBanner
                intent={chainPendingIntent}
                onRetry={chainAttemptRetry}
                onDismiss={chainClearIntent}
              />
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (chainCanSubmit) chainPlot(chainStorylineId, chainContent, chainTitle);
            }}
            className="mt-6 space-y-6"
          >
            {chainDraftRestored && (
              <div className="border-accent/30 bg-accent/5 text-accent flex items-center justify-between rounded border px-3 py-2 text-xs">
                <span>Draft restored</span>
                <button type="button" onClick={discardChainDraft} className="text-muted hover:text-error ml-2 transition-colors">
                  Discard draft
                </button>
              </div>
            )}
            {!chainDraftRestored && (chainTitle || chainContent) && (
              <div className="flex justify-end">
                <button type="button" onClick={discardChainDraft} className="text-muted hover:text-error text-[11px] transition-colors">
                  Discard draft
                </button>
              </div>
            )}
            <div>
              <label className="text-foreground mb-2 block text-sm">Storyline</label>
              {loadingStorylines ? (
                <p className="text-muted text-sm">Loading storylines...</p>
              ) : storylines.length === 0 ? (
                <p className="text-muted text-sm">
                  No active storylines.{" "}
                  <button
                    type="button"
                    onClick={() => setTab("new")}
                    className="text-accent hover:underline"
                  >
                    Create one
                  </button>
                </p>
              ) : (
                <Select
                  value={chainStorylineId != null ? String(chainStorylineId) : ""}
                  onChange={(v) => setChainStorylineId(v ? Number(v) : null)}
                  disabled={chainBusy}
                  placeholder="Select a storyline"
                  options={storylines.map((s) => {
                    const expired = isStorylineExpired(s);
                    return {
                      value: String(s.storyline_id),
                      label: `${s.title} (${s.plot_count} ${s.plot_count === 1 ? "plot" : "plots"})${expired ? " (expired)" : ""}`,
                      disabled: expired,
                    };
                  })}
                />
              )}
            </div>

            <div>
              <label className="text-foreground mb-2 block text-sm">Chapter Title</label>
              <input
                type="text"
                value={chainTitle}
                onChange={(e) => setChainTitle(e.target.value.slice(0, 100))}
                disabled={chainBusy || noStoryline}
                placeholder={noStoryline ? "Select a storyline first" : "e.g. The Silent Storm"}
                maxLength={100}
                className="border-border bg-surface text-foreground placeholder:text-muted w-full rounded border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
              />
              <div className="mt-1 flex justify-between text-xs">
                {!chainTitleValid && chainContent.length > 0 ? (
                  <span className="text-error">Title is required</span>
                ) : (
                  <span />
                )}
                <span className="text-muted">{chainTitle.length} / 100 chars</span>
              </div>
            </div>

            <div>
              <label className="text-foreground mb-2 block text-sm">Next Chapter</label>
              <WritePreviewToggle
                activeTab={chainPreviewTab}
                onTabChange={setChainPreviewTab}
              />
              {chainPreviewTab === "write" ? (
                <textarea
                  value={chainContent}
                  onChange={(e) => setChainContent(e.target.value)}
                  disabled={chainBusy || noStoryline}
                  rows={12}
                  placeholder={noStoryline ? "Select a storyline above to chain a plot" : "Write the next plot (500–10,000 characters)"}
                  className="ruled-paper border-border text-foreground placeholder:text-muted w-full resize-y rounded border focus:border-accent focus:outline-none disabled:opacity-50"
                />
              ) : (
                <ContentPreview content={chainContent} />
              )}
              <div className="mt-1 text-xs">
                <span className={chainContent.length > 0 && !chainValid ? "text-error" : "text-muted"}>
                  {chainCharCount.toLocaleString()} / {MIN_CONTENT_LENGTH.toLocaleString()}&ndash;
                  {MAX_CONTENT_LENGTH.toLocaleString()} chars
                </span>
              </div>
            </div>

            {chainState === "error" && (
              <div className="border-error/30 text-error rounded border px-3 py-2 text-xs">
                {chainError}
              </div>
            )}
            {chainBusy && (
              <div className="border-border text-muted rounded border px-3 py-2 text-xs">
                {STATE_LABELS[chainState]}
              </div>
            )}

            <div className="border-border text-muted rounded border px-3 py-2 text-[10px] leading-relaxed">
              Your content will be stored on IPFS with a content hash recorded on-chain. Once published, plots are permanently immutable and cannot be edited or deleted.
            </div>

            <button
              type="submit"
              disabled={!chainCanSubmit || chainBusy}
              className="border-accent text-accent hover:bg-accent hover:text-background w-full rounded border py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {chainBusy ? STATE_LABELS[chainState] : "Chain Plot"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
