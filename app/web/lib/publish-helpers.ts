/** Cover image constraints enforced by the plotlink backend. */
export const COVER_MAX_BYTES = 1024 * 1024;
export const COVER_ALLOWED_TYPES = ["image/webp", "image/jpeg"] as const;

/**
 * Validate a chosen story cover against the constraints the plotlink backend
 * enforces (WebP/JPEG, ≤1MB) so the writer gets immediate feedback at selection
 * rather than a late error at save. Pure — takes only size/type — and shared by
 * fiction and cartoon (the cover route is content-type agnostic). The 600x900
 * portrait guidance is a recommendation and is not enforced here. Returns a
 * user-facing error string, or null when the file is acceptable.
 */
export function validateCoverImage(file: { size: number; type: string }): string | null {
  if (file.size > COVER_MAX_BYTES) return "Image exceeds 1MB limit";
  if (!(COVER_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return "Only WebP and JPEG images are accepted";
  }
  return null;
}

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
/**
 * Pure predicate: does a story need the explicit legacy-cartoon provider repair?
 *
 * True ONLY when ALL of:
 *  - the resolved content type is "cartoon", AND
 *  - no provider is recorded on the story (legacy `.story.json` with no
 *    `agentProvider`; absent ⇒ would default to Claude at launch), AND
 *  - it is a real, persisted story (NOT a `_new_*` draft — new drafts already
 *    force codex at creation, #254).
 *
 * Fiction, a cartoon that already has a provider, or a `_new_*` draft ⇒ false.
 * This is read-only detection: it never writes or migrates anything.
 */
export function needsLegacyProviderRepair(
  contentType: "fiction" | "cartoon" | undefined,
  agentProvider: "claude" | "codex" | undefined,
  storyName: string | null,
): boolean {
  if (contentType !== "cartoon") return false;
  if (agentProvider) return false;
  if (!storyName || storyName.startsWith("_new_")) return false;
  return true;
}

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
