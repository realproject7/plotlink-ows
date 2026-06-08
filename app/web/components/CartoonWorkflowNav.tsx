/**
 * Persistent right-panel workflow navigation for cartoon stories (#439, spec §2).
 *
 * A normal webtoon creator should not need the file tree: this compact tab bar
 * sits above the right-panel content whenever a CARTOON story is selected and
 * routes between the workflow pages — Progress, Story Info, Episodes, Publish.
 * Episode files are selected from the left story browser; opening any episode
 * keeps the workflow tab on Episodes.
 *
 * Fiction renders no nav (the caller only mounts this for cartoon stories), so
 * the fiction UX is unchanged.
 */

export type CartoonWorkflowTab =
  | "progress"
  | "story-info"
  | "episodes"
  | "publish";

const TABS: { key: CartoonWorkflowTab; label: string }[] = [
  { key: "progress", label: "Progress" },
  { key: "story-info", label: "Story Info" },
  { key: "episodes", label: "Episodes" },
  { key: "publish", label: "Publish" },
];

interface CartoonWorkflowNavProps {
  storyTitle: string;
  active: CartoonWorkflowTab;
  onSelect: (tab: CartoonWorkflowTab) => void;
}

export function CartoonWorkflowNav({ storyTitle, active, onSelect }: CartoonWorkflowNavProps) {
  return (
    <div className="flex-shrink-0 border-b border-border bg-surface/40" data-testid="cartoon-workflow-nav">
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-accent">Cartoon</span>
        <span className="text-xs font-serif text-foreground truncate">{storyTitle}</span>
      </div>
      <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto" role="tablist">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              data-testid={`nav-tab-${tab.key}`}
              data-active={isActive}
              onClick={() => onSelect(tab.key)}
              className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                isActive
                  ? "bg-accent text-white"
                  : "text-muted hover:text-foreground hover:bg-surface"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
