import { useEffect, useState } from "react";
import type { StoryProgress, EpisodeProgress, EpisodeState } from "@app-lib/story-progress";
import type { CartoonChecklistStep } from "@app-lib/cartoon-readiness";
import { WorkflowCoachView } from "./WorkflowCoach";

interface StoryProgressPanelProps {
  storyName: string;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  /** Open a file from the map (the workflow steps link to their file). */
  onOpenFile: (storyName: string, file: string) => void;
  /** Open the Story Info workflow page when metadata/cover is the next gate. */
  onOpenStoryInfo?: () => void;
  /** Bumped by the parent to force a refresh (e.g. after a publish). */
  refreshKey?: number;
}

/**
 * Story-level "View Progress" overview (#418, redesigned #438).
 *
 * For CARTOON stories this is the writer's main production dashboard: a vertical
 * workflow map of numbered sections (Define Story Info → Story Whitepaper →
 * Genesis / Episode 1 → Episode 2 …), each with a checkbox checklist and a clear
 * status. The single next-action CTA stays persistent above the map, while the
 * current section still marks where that action belongs.
 *
 * FICTION keeps the simpler original layout — metadata, setup steps, a chapter
 * list — and is completely unaffected by the cartoon redesign.
 */
export function StoryProgressPanel({ storyName, authFetch, onOpenFile, onOpenStoryInfo, refreshKey = 0 }: StoryProgressPanelProps) {
  const [progress, setProgress] = useState<StoryProgress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await authFetch(`/api/stories/${storyName}/progress`);
        const data = res.ok ? await res.json() : null;
        if (!cancelled) { setProgress(data); setLoading(false); }
      } catch {
        if (!cancelled) { setProgress(null); setLoading(false); }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [storyName, authFetch, refreshKey]);

  if (loading) {
    return <div className="h-full flex items-center justify-center text-muted text-sm" data-testid="progress-loading">Loading progress…</div>;
  }
  // Guard against a missing/malformed response (not just null) so a partial
  // payload can never crash the panel.
  if (!progress || !progress.metadata || !Array.isArray(progress.episodes)) {
    return <div className="h-full flex items-center justify-center text-muted text-sm">Could not load story progress.</div>;
  }

  return progress.contentType === "cartoon"
    ? <CartoonWorkflowMap progress={progress} storyName={storyName} onOpenFile={onOpenFile} onOpenStoryInfo={onOpenStoryInfo} />
    : <FictionProgressView progress={progress} storyName={storyName} onOpenFile={onOpenFile} />;
}

// ---------------------------------------------------------------------------
// Shared header
// ---------------------------------------------------------------------------

function Chip({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "ok" | "warn" }) {
  const cls = tone === "ok" ? "text-green-700" : tone === "warn" ? "text-amber-700" : "text-muted";
  return (
    <span className="text-[11px]">
      <span className="text-muted">{label}: </span>
      <span className={`font-medium ${cls}`}>{value}</span>
    </span>
  );
}

function ProgressHeader({ progress }: { progress: StoryProgress }) {
  const cartoon = progress.contentType === "cartoon";
  const coverTone = progress.cover === "present" ? "ok" : progress.cover === "invalid" ? "warn" : "muted";
  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-serif text-foreground truncate">{progress.metadata.title || progress.name}</h2>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cartoon ? "bg-accent/10 text-accent" : "bg-surface text-muted"}`}>
          {cartoon ? "Cartoon" : "Fiction"}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        <Chip label="Language" value={progress.metadata.language || "Needs metadata"} tone={progress.metadata.language ? "muted" : "warn"} />
        <Chip label="Genre" value={progress.metadata.genre || "Needs metadata"} tone={progress.metadata.genre ? "muted" : "warn"} />
        {progress.metadata.isNsfw != null && <Chip label="Adult" value={progress.metadata.isNsfw ? "Yes (18+)" : "No"} />}
        {cartoon && <Chip label="Cover" value={progress.cover === "present" ? "Ready" : progress.cover === "invalid" ? "Invalid" : "Missing"} tone={coverTone} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cartoon vertical workflow map (#438)
// ---------------------------------------------------------------------------

type SectionStatus = "published" | "done" | "current" | "needs-action" | "not-started";

const SECTION_ICON: Record<SectionStatus, string> = {
  published: "✓", done: "●", current: "◉", "needs-action": "●", "not-started": "○",
};
const SECTION_TONE: Record<SectionStatus, string> = {
  published: "text-green-700", done: "text-green-700", current: "text-accent", "needs-action": "text-amber-700", "not-started": "text-muted",
};
const SECTION_LABEL: Record<SectionStatus, string> = {
  published: "Published", done: "Complete", current: "Current", "needs-action": "Needs action", "not-started": "Not started",
};

type CheckStatus = "done" | "current" | "todo";
const CHECK_ICON: Record<CheckStatus, string> = { done: "✓", current: "◓", todo: "○" };
const CHECK_TONE: Record<CheckStatus, string> = { done: "text-green-700", current: "text-accent", todo: "text-muted" };

interface ChecklistItem { label: string; status: CheckStatus; detail?: string | null }

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px]" data-testid="checklist-item" data-status={item.status}>
      <span className={`${CHECK_TONE[item.status]} flex-shrink-0`} aria-hidden>{CHECK_ICON[item.status]}</span>
      <span className={item.status === "todo" ? "text-muted" : "text-foreground"}>{item.label}</span>
      {item.detail && <span className="text-muted">· {item.detail}</span>}
    </div>
  );
}

/**
 * One numbered workflow section: a status bullet + title + status badge, plus a
 * nested checklist. The header navigates to `openFile` when one is provided.
 */
function Section({
  index, title, status, items, fileName, openFile,
}: {
  index: number;
  title: string;
  status: SectionStatus;
  items: ChecklistItem[];
  /** Power-user secondary text (real file name), shown small. */
  fileName?: string | null;
  /** Called to open the section's underlying file, or undefined for no navigation. */
  openFile?: () => void;
}) {
  const heading = (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`flex-shrink-0 ${SECTION_TONE[status]}`} aria-hidden>{SECTION_ICON[status]}</span>
      <span className="text-xs font-medium text-foreground truncate">{index}. {title}</span>
      {fileName && <span className="text-[10px] text-muted truncate">{fileName}</span>}
      <span className={`ml-auto text-[10px] font-medium ${SECTION_TONE[status]} flex-shrink-0`}>{SECTION_LABEL[status]}</span>
    </div>
  );
  return (
    <div className="px-4 py-2.5 border-b border-border" data-testid={`workflow-section-${index}`} data-status={status}>
      {openFile
        ? <button onClick={openFile} className="w-full text-left rounded hover:bg-surface -mx-1 px-1 py-0.5" data-testid={`section-open-${index}`}>{heading}</button>
        : heading}
      <div className="mt-1.5 ml-1 flex flex-col gap-1 border-l border-border pl-3">
        {items.map((it, i) => <ChecklistRow key={i} item={it} />)}
      </div>
    </div>
  );
}

/** Map a cartoon episode's coarse state + whether it's the active step → a section status. */
function episodeStatus(ep: EpisodeProgress, isActive: boolean): SectionStatus {
  if (ep.published) return "published";
  if (isActive) return "current";
  if (ep.state === "placeholder") return "not-started";
  if (ep.state === "blocked") return "needs-action";
  return "needs-action";
}

/** Build the rendered checklist for a cartoon episode from its production checklist. */
function episodeItems(ep: EpisodeProgress, openingDone = true): ChecklistItem[] {
  const steps = ep.checklist ?? [];
  const items: ChecklistItem[] = [];
  // Genesis is the reader-facing Episode 1 opening, so surface its opening text
  // as the first checklist line (done once genesis.md is written; to-do in the
  // not-yet-written stub); a plain plot episode starts at its cut plan.
  if (ep.kind === "genesis") items.push({ label: "Opening text", status: openingDone ? "done" : "todo" });
  if (steps.length === 0) {
    // Not started yet — no cut plan. Show the first couple of steps as to-do so
    // the writer sees what starting the episode involves.
    items.push({ label: "Cut plan", status: "todo" });
    items.push({ label: "Clean artwork", status: "todo" });
    return items;
  }
  for (const s of steps) items.push(checklistStepItem(s));
  return items;
}

function checklistStepItem(s: CartoonChecklistStep): ChecklistItem {
  return { label: s.label, status: s.status, detail: s.detail };
}

/** The not-yet-written Genesis (Episode 1) stub, so the section — and its CTA —
 * always render even before genesis.md exists. */
const GENESIS_STUB: EpisodeProgress = {
  file: "genesis.md", label: "Episode 1 / Genesis", kind: "genesis", title: null,
  state: "placeholder", summary: "", published: false, checklist: [], cuts: null,
};

/** The single Story-Info next step, when cover/metadata is the active gate. */
function storyInfoNextStep(progress: StoryProgress): string {
  if (progress.cover !== "present") {
    return progress.cover === "invalid"
      ? "Replace the cover image — it must be a valid WebP or JPEG."
      : "Add a cover image before publishing.";
  }
  const missing: string[] = [];
  if (!progress.metadata.language) missing.push("language");
  if (!progress.metadata.genre) missing.push("genre");
  if (!progress.metadata.title) missing.push("title");
  return `Add the story ${missing.join(" and ") || "details"} before publishing.`;
}

function CartoonWorkflowMap({
  progress, storyName, onOpenFile, onOpenStoryInfo,
}: {
  progress: StoryProgress;
  storyName: string;
  onOpenFile: (storyName: string, file: string) => void;
  onOpenStoryInfo?: () => void;
}) {
  const coach = progress.coach ?? null;
  const m = progress.metadata;
  const hasStructure = progress.setup.hasStructure;
  const hasGenesis = progress.setup.hasGenesis;
  const coverDone = progress.cover === "present";
  // Required publish metadata (title/language/genre) still hard-gates the active
  // step. A missing COVER is a publish-readiness recommendation, NOT the primary
  // step (#462) — it's kept out of the active-gate decision while an episode is
  // mid-production, so the cut/lettering production CTA leads instead.
  const metadataIncomplete = !m.title || !m.language || !m.genre;
  const storyInfoIncomplete = metadataIncomplete || !coverDone;
  // The active (first unpublished) episode and whether it still has production
  // work to do (anything short of publish-ready).
  const activeEp = progress.episodes.find((e) => !e.published) ?? null;
  const productionPending = !!activeEp && activeEp.state !== "ready";

  // The SINGLE active gate, chosen in the same order buildStoryProgress derives
  // its next step (structure → genesis → story info/cover → active episode), so
  // the one CTA always matches the story-level next action and lands in its own
  // section. `deriveCartoonCoach` agrees on every gate EXCEPT story info (it
  // skips cover/metadata), so we own that gate here; the coach drives the rest.
  // Crucially, every gate maps to a section that is ALWAYS rendered (Whitepaper,
  // the always-present Genesis section, an episode, or the trailing block), so
  // the CTA can never fall through the cracks (#444 review: it vanished when the
  // bible was written but Genesis wasn't).
  let activeKey: string | null;
  if (!hasStructure) activeKey = "whitepaper";
  else if (!hasGenesis) activeKey = "genesis.md";
  else if (metadataIncomplete) activeKey = "story-info";
  // #462: a mid-production episode leads over a missing cover — the cut/lettering
  // production CTA is the primary step. A missing cover only becomes the active
  // step once the active episode's production is complete (no work pending),
  // where it reads as the publish-readiness recommendation.
  else if (productionPending && coach?.episodeFile) activeKey = coach.episodeFile;
  else if (!coverDone) activeKey = "story-info";
  else activeKey = coach?.episodeFile ?? null;

  // Story Info owns the CTA when metadata/cover is the gate. The coach carries
  // no cover action, so route the standardized top CTA to the
  // existing Story Info workflow page.
  const storyInfoCta = (
    <div className="m-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 shadow-sm" data-testid="story-info-cta">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="inline-flex rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
            Story info
          </span>
          <p className="mt-1 text-sm text-foreground" data-testid="story-info-next-action">
            <span className="font-semibold">Next: </span>
            <span>{storyInfoNextStep(progress)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenStoryInfo}
          disabled={!onOpenStoryInfo}
          className="flex-shrink-0 rounded bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="story-info-next-action-btn"
        >
          Next Action
        </button>
      </div>
    </div>
  );

  const topNextAction = activeKey === "story-info" ? storyInfoCta : (
    <WorkflowCoachView
      coach={coach ?? null}
      showEmptyState
      onAction={(action, episodeFile) => {
        if (action === "view-progress") return; // already here
        if (episodeFile) onOpenFile(storyName, episodeFile);
      }}
    />
  );

  const infoItems: ChecklistItem[] = [
    { label: "Public title", status: m.title ? "done" : "todo", detail: m.title ?? null },
    { label: "Language", status: m.language ? "done" : "todo", detail: m.language ?? null },
    { label: "Genre", status: m.genre ? "done" : "todo", detail: m.genre ?? null },
    { label: "Cover image", status: coverDone ? "done" : "todo", detail: progress.cover === "invalid" ? "Invalid — re-import" : coverDone ? null : "Missing" },
  ];
  const infoStatus: SectionStatus = activeKey === "story-info" ? "current" : storyInfoIncomplete ? "needs-action" : "done";
  const whitepaperStatus: SectionStatus = hasStructure ? "done" : activeKey === "whitepaper" ? "current" : "not-started";

  const genesisEp = progress.episodes.find((e) => e.kind === "genesis") ?? null;
  const plotEps = progress.episodes.filter((e) => e.kind === "plot");

  let idx = 0;

  return (
    <div className="h-full overflow-y-auto" data-testid="story-progress-panel">
      <ProgressHeader progress={progress} />
      <div className="border-b border-border" data-testid="persistent-next-action">
        {topNextAction}
      </div>
      <p className="px-4 pt-3 pb-1 text-[11px] font-medium text-muted uppercase tracking-wider">Production Progress</p>

      <Section
        index={++idx}
        title="Define Story Info"
        status={infoStatus}
        items={infoItems}
      />

      <Section
        index={++idx}
        title="Story Whitepaper"
        status={whitepaperStatus}
        fileName="structure.md"
        openFile={hasStructure ? () => onOpenFile(storyName, "structure.md") : undefined}
        items={[{ label: "Planning document", status: hasStructure ? "done" : "todo", detail: hasStructure ? null : "Not written yet" }]}
      />

      {/* Genesis / Episode 1 — always shown (a not-started stub before it's
          written), so the "Write the Genesis" CTA always has a home. */}
      {genesisEp ? (
        <EpisodeSection
          index={++idx} ep={genesisEp} isActive={activeKey === genesisEp.file}
          storyName={storyName} onOpenFile={onOpenFile}
        />
      ) : (
        <EpisodeSection
          index={++idx} ep={GENESIS_STUB} isActive={activeKey === "genesis.md"} openingDone={false} canOpen={false}
          storyName={storyName} onOpenFile={onOpenFile}
        />
      )}

      {plotEps.map((ep) => (
        <EpisodeSection
          key={ep.file} index={++idx} ep={ep} isActive={activeKey === ep.file}
          storyName={storyName} onOpenFile={onOpenFile}
        />
      ))}

      <div className="px-4 py-2 text-[11px] text-muted flex flex-wrap gap-x-3" data-testid="progress-summary">
        <span>{progress.summary.published} published</span>
        <span>{progress.summary.readyToPublish} ready</span>
        {progress.summary.placeholders > 0 && <span>{progress.summary.placeholders} not started</span>}
        {progress.summary.blocked > 0 && <span className="text-error">{progress.summary.blocked} need fixes</span>}
      </div>
    </div>
  );
}

/** A `progress-episode-<file>` section, kept testid-stable so clicking it opens the file. */
function EpisodeSection({
  index, ep, isActive, storyName, onOpenFile, openingDone = true, canOpen = true,
}: {
  index: number;
  ep: EpisodeProgress;
  isActive: boolean;
  storyName: string;
  onOpenFile: (storyName: string, file: string) => void;
  /** Whether the genesis opening text is already written (false for the stub). */
  openingDone?: boolean;
  /** Whether the header navigates to the file (false for the not-yet-written stub). */
  canOpen?: boolean;
}) {
  const status = episodeStatus(ep, isActive);
  const items = episodeItems(ep, openingDone);
  const title = ep.title ? `${ep.label} · ${ep.title}` : ep.label;
  const heading = (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`flex-shrink-0 ${SECTION_TONE[status]}`} aria-hidden>{SECTION_ICON[status]}</span>
      <span className="text-xs font-medium text-foreground truncate">{index}. {title}</span>
      <span className="text-[10px] text-muted truncate">{ep.file}</span>
      <span className={`ml-auto text-[10px] font-medium ${SECTION_TONE[status]} flex-shrink-0`}>{SECTION_LABEL[status]}</span>
    </div>
  );
  return (
    <div className="px-4 py-2.5 border-b border-border" data-testid={`workflow-section-${index}`} data-status={status}>
      {canOpen ? (
        <button
          onClick={() => onOpenFile(storyName, ep.file)}
          data-testid={`progress-episode-${ep.file}`}
          data-state={ep.state}
          className="w-full text-left rounded hover:bg-surface -mx-1 px-1 py-0.5"
        >
          {heading}
        </button>
      ) : (
        <div data-state={ep.state}>{heading}</div>
      )}
      <div className="mt-1.5 ml-1 flex flex-col gap-1 border-l border-border pl-3">
        {items.map((it, i) => <ChecklistRow key={i} item={it} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fiction progress view — the original, simpler layout (unchanged behavior)
// ---------------------------------------------------------------------------

const STATE_ICON: Record<EpisodeState, string> = {
  published: "✓", ready: "●", "in-progress": "◐", planning: "○", placeholder: "○", blocked: "✕", draft: "○",
};
const STATE_TONE: Record<EpisodeState, string> = {
  published: "text-green-700", ready: "text-green-700", "in-progress": "text-accent", planning: "text-accent", placeholder: "text-muted", blocked: "text-error", draft: "text-muted",
};
const STATE_LABEL: Record<EpisodeState, string> = {
  published: "Published", ready: "Ready", "in-progress": "In progress", planning: "Planning", placeholder: "Not started", blocked: "Needs fixes", draft: "Draft",
};

function FictionProgressView({
  progress, storyName, onOpenFile,
}: { progress: StoryProgress; storyName: string; onOpenFile: (storyName: string, file: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="h-full overflow-y-auto" data-testid="story-progress-panel">
      <ProgressHeader progress={progress} />

      {progress.nextAction && (
        <div className="px-4 py-2 border-b border-accent/30 bg-accent/5 text-xs space-y-1.5" data-testid="progress-next-action">
          <div>
            <span className="font-medium text-foreground">Next: </span>
            <span className="text-muted">{progress.nextAction}</span>
          </div>
          {progress.nextPrompt && (
            <div className="flex items-start gap-1.5" data-testid="progress-next-prompt">
              <code className="flex-1 rounded border border-border bg-surface px-1.5 py-1 text-[10px] text-foreground break-words">{progress.nextPrompt}</code>
              <button
                onClick={() => { if (progress.nextPrompt) navigator.clipboard?.writeText(progress.nextPrompt).then(() => { setCopied(true); }).catch(() => {}); }}
                data-testid="copy-next-prompt"
                className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:border-accent hover:text-accent transition-colors flex-shrink-0"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Setup steps. */}
      <div className="px-4 py-2 border-b border-border flex flex-col gap-1">
        <StepRow done={progress.setup.hasStructure} label="Story bible (structure.md)"
          onClick={progress.setup.hasStructure ? () => onOpenFile(storyName, "structure.md") : undefined} />
        <StepRow done={progress.setup.hasGenesis} label="Genesis written"
          onClick={progress.setup.hasGenesis ? () => onOpenFile(storyName, "genesis.md") : undefined} />
      </div>

      {/* Chapter list. */}
      <div className="px-4 py-2">
        <p className="text-[11px] font-medium text-muted uppercase tracking-wider mb-1.5">Chapters</p>
        {progress.episodes.length === 0 ? (
          <p className="text-xs text-muted italic" data-testid="progress-no-episodes">No chapters yet — write the Genesis to start.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {progress.episodes.map((ep) => (
              <li key={ep.file}>
                <button
                  onClick={() => onOpenFile(storyName, ep.file)}
                  data-testid={`progress-episode-${ep.file}`}
                  data-state={ep.state}
                  className="w-full text-left flex items-start gap-2 rounded px-2 py-1.5 hover:bg-surface"
                >
                  <span className={`mt-0.5 ${STATE_TONE[ep.state]}`} aria-hidden>{STATE_ICON[ep.state]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-foreground">{ep.label}</span>
                      {ep.title && <span className="text-[11px] text-muted truncate">· {ep.title}</span>}
                      <span className={`ml-auto text-[10px] font-medium ${STATE_TONE[ep.state]}`}>{STATE_LABEL[ep.state]}</span>
                    </span>
                    <span className="block text-[11px] text-muted">{ep.summary}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="px-4 py-2 border-t border-border text-[11px] text-muted flex flex-wrap gap-x-3" data-testid="progress-summary">
        <span>{progress.summary.published} published</span>
        {progress.summary.blocked > 0 && <span className="text-error">{progress.summary.blocked} need fixes</span>}
      </div>
    </div>
  );
}

function StepRow({ done, label, onClick }: { done: boolean; label: string; onClick?: () => void }) {
  const inner = (
    <span className="flex items-center gap-2 text-xs">
      <span className={done ? "text-green-700" : "text-muted"} aria-hidden>{done ? "✓" : "○"}</span>
      <span className={done ? "text-foreground" : "text-muted"}>{label}</span>
    </span>
  );
  return onClick
    ? <button onClick={onClick} className="text-left hover:underline">{inner}</button>
    : <div>{inner}</div>;
}
