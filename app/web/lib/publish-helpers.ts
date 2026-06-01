export function getContentTypeForPublish(
  storyContentTypes: Record<string, string>,
  storyName: string,
  storylineId: number | undefined,
): string | undefined {
  if (storyContentTypes[storyName] === "cartoon" && !storylineId) {
    return "cartoon";
  }
  return undefined;
}

/**
 * Resolve the effective content type for the currently-selected story, falling
 * back to the pending `_new_*` draft map before persistence.
 *
 * A freshly-created cartoon draft has no `.story.json` yet, so it is absent from
 * the persisted `storyContentTypes` state; its type lives only in the in-memory
 * pending map (`contentTypeMap`) until the rename/persist completes. Preview and
 * terminal-launch gating must both see "cartoon" immediately — otherwise a new
 * cartoon draft's terminal could launch before Codex readiness gating applies.
 *
 * Order: persisted state → pending draft map → "fiction" default. Returns
 * undefined only when no story is selected.
 */
export function resolveSelectedContentType(
  selectedStory: string | null,
  storyContentTypes: Record<string, "fiction" | "cartoon">,
  pendingContentTypes: Map<string, "fiction" | "cartoon">,
): "fiction" | "cartoon" | undefined {
  if (!selectedStory) return undefined;
  return (
    storyContentTypes[selectedStory] ||
    pendingContentTypes.get(selectedStory) ||
    "fiction"
  );
}
