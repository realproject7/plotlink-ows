import { describe, it, expect, vi } from "vitest";
import { getContentTypeForPublish, resolveSelectedContentType, needsLegacyProviderRepair, validateCoverImage, COVER_MAX_BYTES, attachCoverToStoryline, derivePublishTitle, extractH1Title, prettifyStorySlug, hasPriorOnChainPlot, shouldBlockDuplicatePlotPublish, cartoonCoverReadiness, COVER_GUIDANCE, episodeTitleFromPlotFile, isRawFilenameTitle, hasExplicitEpisodeTitle, isGenericEpisodeTitle } from "./publish-helpers";

describe("getContentTypeForPublish", () => {
  it("returns 'cartoon' for cartoon genesis (no storylineId)", () => {
    expect(getContentTypeForPublish({ "my-story": "cartoon" }, "my-story", undefined)).toBe("cartoon");
  });

  it("returns undefined for cartoon plot (has storylineId)", () => {
    expect(getContentTypeForPublish({ "my-story": "cartoon" }, "my-story", 42)).toBeUndefined();
  });

  it("returns undefined for fiction genesis", () => {
    expect(getContentTypeForPublish({ "my-story": "fiction" }, "my-story", undefined)).toBeUndefined();
  });

  it("returns undefined for fiction plot", () => {
    expect(getContentTypeForPublish({ "my-story": "fiction" }, "my-story", 42)).toBeUndefined();
  });

  it("returns undefined for unknown story", () => {
    expect(getContentTypeForPublish({}, "unknown", undefined)).toBeUndefined();
  });

  it("returns cartoon after metadata update (simulates stale closure fix)", () => {
    let storyContentTypes: Record<string, string> = {};

    const buildPayload = (storyName: string, storylineId: number | undefined) => {
      const ct = getContentTypeForPublish(storyContentTypes, storyName, storylineId);
      return ct ? { contentType: ct } : {};
    };

    expect(buildPayload("my-cartoon", undefined)).toEqual({});

    storyContentTypes = { "my-cartoon": "cartoon" };

    expect(buildPayload("my-cartoon", undefined)).toEqual({ contentType: "cartoon" });
  });
});

describe("resolveSelectedContentType", () => {
  it("returns undefined when no story is selected", () => {
    expect(resolveSelectedContentType(null, {}, new Map())).toBeUndefined();
  });

  it("uses the persisted content type when present", () => {
    expect(
      resolveSelectedContentType("my-story", { "my-story": "cartoon" }, new Map()),
    ).toBe("cartoon");
    expect(
      resolveSelectedContentType("my-story", { "my-story": "fiction" }, new Map()),
    ).toBe("fiction");
  });

  it("falls back to the pending _new_* draft map before persistence (cartoon)", () => {
    // The core #264 case: a fresh cartoon draft is absent from persisted state
    // but present in the pending map — must resolve to "cartoon" so terminal
    // launch gating recognizes it before .story.json exists.
    const pending = new Map<string, "fiction" | "cartoon">([["_new_123", "cartoon"]]);
    expect(resolveSelectedContentType("_new_123", {}, pending)).toBe("cartoon");
  });

  it("falls back to the pending map for a fiction draft too", () => {
    const pending = new Map<string, "fiction" | "cartoon">([["_new_9", "fiction"]]);
    expect(resolveSelectedContentType("_new_9", {}, pending)).toBe("fiction");
  });

  it("prefers persisted state over the pending map", () => {
    const pending = new Map<string, "fiction" | "cartoon">([["s", "fiction"]]);
    expect(resolveSelectedContentType("s", { s: "cartoon" }, pending)).toBe("cartoon");
  });

  it("defaults to fiction for a selected but unknown story", () => {
    expect(resolveSelectedContentType("ghost", {}, new Map())).toBe("fiction");
  });
});

describe("needsLegacyProviderRepair", () => {
  it("true for a real cartoon with no provider", () => {
    expect(needsLegacyProviderRepair("cartoon", undefined, "my-cartoon")).toBe(true);
  });

  it("false for a cartoon already set to codex", () => {
    expect(needsLegacyProviderRepair("cartoon", "codex", "my-cartoon")).toBe(false);
  });

  it("false for a cartoon already set to claude", () => {
    expect(needsLegacyProviderRepair("cartoon", "claude", "my-cartoon")).toBe(false);
  });

  it("false for fiction with no provider", () => {
    expect(needsLegacyProviderRepair("fiction", undefined, "my-novel")).toBe(false);
  });

  it("false for a _new_* cartoon draft with no provider", () => {
    expect(needsLegacyProviderRepair("cartoon", undefined, "_new_1730000000000")).toBe(false);
  });

  it("false for undefined content type", () => {
    expect(needsLegacyProviderRepair(undefined, undefined, "my-cartoon")).toBe(false);
  });

  it("false when no story is selected", () => {
    expect(needsLegacyProviderRepair("cartoon", undefined, null)).toBe(false);
  });
});

describe("validateCoverImage", () => {
  it("accepts a valid WebP cover", () => {
    expect(validateCoverImage({ size: 500 * 1024, type: "image/webp" })).toBeNull();
  });

  it("accepts a valid JPEG cover", () => {
    expect(validateCoverImage({ size: 500 * 1024, type: "image/jpeg" })).toBeNull();
  });

  it("accepts a cover at exactly 1MB", () => {
    expect(validateCoverImage({ size: COVER_MAX_BYTES, type: "image/webp" })).toBeNull();
  });

  it("rejects a cover over 1MB", () => {
    expect(validateCoverImage({ size: COVER_MAX_BYTES + 1, type: "image/webp" })).toBe("Image exceeds 1MB limit");
  });

  it("rejects a PNG cover with a clear WebP/JPEG message (regression: was accepted via startsWith('image/'))", () => {
    expect(validateCoverImage({ size: 100, type: "image/png" })).toBe("Only WebP and JPEG images are accepted");
  });

  it("rejects a GIF cover", () => {
    expect(validateCoverImage({ size: 100, type: "image/gif" })).toBe("Only WebP and JPEG images are accepted");
  });

  it("rejects a non-image file", () => {
    expect(validateCoverImage({ size: 100, type: "application/pdf" })).toBe("Only WebP and JPEG images are accepted");
  });

  it("checks size before type (oversized takes priority)", () => {
    expect(validateCoverImage({ size: COVER_MAX_BYTES + 1, type: "image/png" })).toBe("Image exceeds 1MB limit");
  });
});

describe("extractH1Title", () => {
  it("returns the first H1, trimmed", () => {
    expect(extractH1Title("# Swipe Right, Refund Later\n\nprose...")).toBe("Swipe Right, Refund Later");
    expect(extractH1Title("intro\n\n#   Spaced Title  \nmore")).toBe("Spaced Title");
  });
  it("returns null when there is no H1 (or only an empty heading)", () => {
    expect(extractH1Title("just prose, no heading")).toBeNull();
    expect(extractH1Title("## Subheading only")).toBeNull();
    expect(extractH1Title("#\n")).toBeNull();
  });
});

describe("prettifyStorySlug", () => {
  it("title-cases a hyphen/underscore slug", () => {
    expect(prettifyStorySlug("swipe-right-refund-later")).toBe("Swipe Right Refund Later");
    expect(prettifyStorySlug("my_first_story")).toBe("My First Story");
  });
});

describe("derivePublishTitle (#331)", () => {
  it("uses a headingless cartoon genesis's structure.md title, not 'genesis'", () => {
    const title = derivePublishTitle({
      fileName: "genesis.md",
      fileContent: "She swiped right on disaster, then asked for a refund.\n",
      storySlug: "swipe-right-refund-later",
      structureContent: "# Swipe Right, Refund Later\n\n## Visual Style Guide\n...",
    });
    expect(title).toBe("Swipe Right, Refund Later");
  });

  it("prefers genesis.md's own H1 over structure.md", () => {
    const title = derivePublishTitle({
      fileName: "genesis.md",
      fileContent: "# Genesis Own Title\n\nhook",
      storySlug: "swipe-right-refund-later",
      structureContent: "# Structure Title",
    });
    expect(title).toBe("Genesis Own Title");
  });

  it("falls back to the prettified slug, never raw 'genesis', when no H1 anywhere", () => {
    const title = derivePublishTitle({
      fileName: "genesis.md",
      fileContent: "headingless prose hook",
      storySlug: "swipe-right-refund-later",
      structureContent: "## no h1 here\nonly prose",
    });
    expect(title).toBe("Swipe Right Refund Later");
    expect(title).not.toBe("genesis");
  });

  it("falls back to the prettified slug when structure.md is missing", () => {
    const title = derivePublishTitle({
      fileName: "genesis.md",
      fileContent: "headingless prose hook",
      storySlug: "swipe-right-refund-later",
      structureContent: null,
    });
    expect(title).toBe("Swipe Right Refund Later");
  });

  it("keeps plot files on H1-or-filename (storyline title unaffected, fiction-compatible)", () => {
    expect(
      derivePublishTitle({ fileName: "plot-01.md", fileContent: "# Chapter One\nbody", storySlug: "s", structureContent: "# Story" }),
    ).toBe("Chapter One");
    expect(
      derivePublishTitle({ fileName: "plot-02.md", fileContent: "no heading", storySlug: "s", structureContent: "# Story" }),
    ).toBe("plot-02");
  });

  it("caps the resolved title at 60 chars", () => {
    const long = "#" + " A".repeat(80);
    const title = derivePublishTitle({ fileName: "genesis.md", fileContent: long, storySlug: "s" });
    expect(title.length).toBe(60);
  });
});

describe("episodeTitleFromPlotFile (#347)", () => {
  it("makes a friendly Episode label from a plot filename", () => {
    expect(episodeTitleFromPlotFile("plot-01.md")).toBe("Episode 01");
    expect(episodeTitleFromPlotFile("plot-7.md")).toBe("Episode 07");
    expect(episodeTitleFromPlotFile("plot-12.md")).toBe("Episode 12");
  });
  it("returns null for non-plot filenames", () => {
    expect(episodeTitleFromPlotFile("genesis.md")).toBeNull();
    expect(episodeTitleFromPlotFile("structure.md")).toBeNull();
  });
});

describe("isRawFilenameTitle (#358)", () => {
  it("flags a raw genesis label", () => {
    expect(isRawFilenameTitle("genesis", "genesis.md")).toBe(true);
    expect(isRawFilenameTitle("Genesis", "genesis.md")).toBe(true);
    expect(isRawFilenameTitle("  GENESIS ", "genesis.md")).toBe(true);
  });
  it("flags a raw plot-NN label", () => {
    expect(isRawFilenameTitle("plot-01", "plot-01.md")).toBe(true);
    expect(isRawFilenameTitle("Plot-07", "plot-07.md")).toBe(true);
    expect(isRawFilenameTitle("plot-2", "plot-12.md")).toBe(true); // any plot-N shape
  });
  it("treats an empty title as raw/unusable", () => {
    expect(isRawFilenameTitle("", "genesis.md")).toBe(true);
    expect(isRawFilenameTitle("   ", "plot-01.md")).toBe(true);
  });
  it("passes a real reader-facing title", () => {
    expect(isRawFilenameTitle("Coupon Crush at Closing Time", "genesis.md")).toBe(false);
    expect(isRawFilenameTitle("Episode 01", "plot-01.md")).toBe(false);
    expect(isRawFilenameTitle("The Couple Coupon", "plot-01.md")).toBe(false);
  });
});

describe("hasExplicitEpisodeTitle (#365)", () => {
  const SKELETON = "<!-- ows:cartoon-cut cut-001 start -->\n![c](https://x)\n<!-- ows:cartoon-cut cut-001 end -->";
  it("is true when the cut plan has a non-empty title", () => {
    expect(hasExplicitEpisodeTitle({ fileContent: SKELETON, episodeTitle: "The Couple Coupon" })).toBe(true);
  });
  it("is true when the plot markdown has a real H1 (even with no cut-plan title)", () => {
    expect(hasExplicitEpisodeTitle({ fileContent: "# The Couple Coupon\n\n" + SKELETON, episodeTitle: null })).toBe(true);
  });
  it("is false when there is neither a cut-plan title nor an H1 (Episode NN fallback only)", () => {
    expect(hasExplicitEpisodeTitle({ fileContent: SKELETON, episodeTitle: null })).toBe(false);
    expect(hasExplicitEpisodeTitle({ fileContent: SKELETON, episodeTitle: "   " })).toBe(false);
    expect(hasExplicitEpisodeTitle({ fileContent: SKELETON })).toBe(false);
  });
  // #368: a generic explicit title (real H1 or cut-plan) no longer counts.
  it("is false when the cut-plan title is a generic 'Episode 01' label (#368)", () => {
    expect(hasExplicitEpisodeTitle({ fileContent: SKELETON, episodeTitle: "Episode 01" })).toBe(false);
  });
  it("is false when the H1 is a generic '# Episode 01' label (#368)", () => {
    expect(hasExplicitEpisodeTitle({ fileContent: "# Episode 01\n\n" + SKELETON, episodeTitle: null })).toBe(false);
  });
  it("is true when an episode number is paired with real title text (#368)", () => {
    expect(hasExplicitEpisodeTitle({ fileContent: SKELETON, episodeTitle: "Episode 01 — The Couple Coupon" })).toBe(true);
    expect(hasExplicitEpisodeTitle({ fileContent: "# Episode 01 — The Couple Coupon\n\n" + SKELETON, episodeTitle: null })).toBe(true);
  });
  // #368 precedence: derivePublishTitle gives the plot H1 priority over the cut
  // plan title, so a generic H1 must block even when a real cut-plan title exists
  // (otherwise the gate would pass but the generic H1 would publish).
  it("is false when a generic H1 is present even if the cut-plan title is real (H1 wins) (#368)", () => {
    expect(hasExplicitEpisodeTitle({ fileContent: "# Episode 01\n\n" + SKELETON, episodeTitle: "The Couple Coupon" })).toBe(false);
    // Sanity: the resolved publish title in this case really is the generic H1.
    expect(derivePublishTitle({ fileName: "plot-01.md", fileContent: "# Episode 01\n\n" + SKELETON, storySlug: "s", contentType: "cartoon", episodeTitle: "The Couple Coupon" })).toBe("Episode 01");
  });
  it("is true when a real H1 is present even if the cut-plan title is generic", () => {
    expect(hasExplicitEpisodeTitle({ fileContent: "# The Couple Coupon\n\n" + SKELETON, episodeTitle: "Episode 01" })).toBe(true);
  });
});

describe("isGenericEpisodeTitle (#368)", () => {
  it("flags generic number-label titles", () => {
    for (const t of ["Episode 01", "Episode 1", "episode 7", "Ep 01", "Ep. 01", "Ep.01", "Chapter 01", "Ch 1", "Ch. 02", "Part 3", "Pt 4", "Plot 01", "plot-01", "plot_1", "plot 2", "01", "7", "  Episode  01  "]) {
      expect(isGenericEpisodeTitle(t)).toBe(true);
    }
  });
  it("treats empty/whitespace as generic (unusable)", () => {
    expect(isGenericEpisodeTitle("")).toBe(true);
    expect(isGenericEpisodeTitle("   ")).toBe(true);
  });
  it("allows real reader-facing titles, including number + title text", () => {
    for (const t of ["The Couple Coupon", "Closing-Time Confession", "Episode 01 — The Couple Coupon", "Episode 1: The Heist", "Chapter 2 - Aftermath", "Episode One"]) {
      expect(isGenericEpisodeTitle(t)).toBe(false);
    }
  });
});

describe("derivePublishTitle cartoon plot titles (#347)", () => {
  it("uses the cut plan episode title for a headingless cartoon plot (never the raw filename)", () => {
    const title = derivePublishTitle({
      fileName: "plot-01.md",
      fileContent: "<!-- ows:cartoon-cut cut-001 start -->\n![c](https://x)\n<!-- ows:cartoon-cut cut-001 end -->",
      storySlug: "s",
      contentType: "cartoon",
      episodeTitle: "First Rain",
    });
    expect(title).toBe("First Rain");
  });

  it("falls back to a friendly 'Episode NN', never the raw 'plot-NN', for a headingless cartoon plot with no cuts title", () => {
    const title = derivePublishTitle({
      fileName: "plot-01.md",
      fileContent: "image-only markdown, no heading",
      storySlug: "s",
      contentType: "cartoon",
      episodeTitle: null,
    });
    expect(title).toBe("Episode 01");
    expect(title).not.toBe("plot-01");
  });

  it("prefers the plot's own H1 over the cuts title", () => {
    expect(
      derivePublishTitle({ fileName: "plot-02.md", fileContent: "# Real Heading\nx", storySlug: "s", contentType: "cartoon", episodeTitle: "Cuts Title" }),
    ).toBe("Real Heading");
  });

  it("does NOT change fiction plot behavior (still H1-or-filename)", () => {
    expect(
      derivePublishTitle({ fileName: "plot-01.md", fileContent: "no heading", storySlug: "s", contentType: "fiction" }),
    ).toBe("plot-01");
  });

  it("cartoon headingless genesis still resolves to the structure.md story title (#331 preserved)", () => {
    expect(
      derivePublishTitle({ fileName: "genesis.md", fileContent: "hook prose", storySlug: "swipe-right", contentType: "cartoon", structureContent: "# Swipe Right" }),
    ).toBe("Swipe Right");
  });
});

describe("hasPriorOnChainPlot (#332)", () => {
  it("is true when a txHash and a real plotIndex are recorded", () => {
    expect(hasPriorOnChainPlot({ status: "published", txHash: "0xabc", storylineId: 58, plotIndex: 1 })).toBe(true);
    // Retained across a content edit that reset status to pending.
    expect(hasPriorOnChainPlot({ status: "pending", txHash: "0xabc", storylineId: 58, plotIndex: 1 })).toBe(true);
  });
  it("is false for a first-time / never-minted plot", () => {
    expect(hasPriorOnChainPlot({ status: "pending" })).toBe(false);
    expect(hasPriorOnChainPlot({ status: "draft" })).toBe(false);
    expect(hasPriorOnChainPlot(null)).toBe(false);
    expect(hasPriorOnChainPlot(undefined)).toBe(false);
  });
  it("is false when plotIndex is missing or 0 even if a txHash exists", () => {
    expect(hasPriorOnChainPlot({ status: "pending", txHash: "0xabc" })).toBe(false);
    expect(hasPriorOnChainPlot({ status: "pending", txHash: "0xabc", plotIndex: 0 })).toBe(false);
  });
});

describe("shouldBlockDuplicatePlotPublish (#332)", () => {
  it("blocks a fresh mint for an already-published plot (normal button)", () => {
    expect(shouldBlockDuplicatePlotPublish({ status: "published", txHash: "0xabc", storylineId: 58, plotIndex: 1 })).toBe(true);
  });
  it("blocks the edit-then-republish path (status reset to pending, on-chain fields retained)", () => {
    expect(shouldBlockDuplicatePlotPublish({ status: "pending", txHash: "0xabc", storylineId: 58, plotIndex: 1 })).toBe(true);
  });
  it("does NOT block the published-not-indexed recovery path (UI gates Retry Publish behind a confirm)", () => {
    expect(shouldBlockDuplicatePlotPublish({ status: "published-not-indexed", txHash: "0xabc", storylineId: 58, plotIndex: 1 })).toBe(false);
  });
  it("does NOT block a first-time publish (no prior on-chain tx)", () => {
    expect(shouldBlockDuplicatePlotPublish({ status: "pending" })).toBe(false);
    expect(shouldBlockDuplicatePlotPublish({ status: "draft" })).toBe(false);
    expect(shouldBlockDuplicatePlotPublish(undefined)).toBe(false);
  });
});

describe("cartoonCoverReadiness (#337)", () => {
  it("reports 'none' when there is no cover", () => {
    const r = cartoonCoverReadiness({ hasSelectedCover: false, invalid: false, attached: false });
    expect(r.state).toBe("none");
    expect(r.label).toMatch(/no cover yet/i);
  });

  it("reports 'selected' when a valid local cover is queued", () => {
    const r = cartoonCoverReadiness({ hasSelectedCover: true, invalid: false, attached: false });
    expect(r.state).toBe("selected");
    expect(r.label).toMatch(/uploaded when you publish/i);
  });

  it("reports 'invalid' over a queued selection (error is never hidden)", () => {
    const r = cartoonCoverReadiness({ hasSelectedCover: true, invalid: true, attached: false });
    expect(r.state).toBe("invalid");
    expect(r.label).toMatch(/WebP or JPEG, max 1MB/i);
  });

  it("reports 'attached' once a cover is on the storyline (wins over everything)", () => {
    const r = cartoonCoverReadiness({ hasSelectedCover: true, invalid: true, attached: true });
    expect(r.state).toBe("attached");
    expect(r.tone).toBe("success");
  });

  it("guidance names the format, size, shape, and the AI-text caveat", () => {
    expect(COVER_GUIDANCE).toMatch(/WebP/);
    expect(COVER_GUIDANCE).toMatch(/1MB/);
    expect(COVER_GUIDANCE).toMatch(/600.?900/);
    expect(COVER_GUIDANCE).toMatch(/AI text|unreadable/i);
  });
});

describe("attachCoverToStoryline", () => {
  const file = new File(["x"], "cover.webp", { type: "image/webp" });

  function jsonRes(ok: boolean, body: unknown) {
    return { ok, json: () => Promise.resolve(body) } as unknown as Response;
  }

  it("uploads the cover then sets it on the storyline, returning the cid", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const authFetch = vi.fn((url: string, opts?: RequestInit) => {
      calls.push({ url, method: opts?.method, body: opts?.body });
      if (url.includes("upload-cover")) return Promise.resolve(jsonRes(true, { cid: "QmCid" }));
      return Promise.resolve(jsonRes(true, { ok: true }));
    });

    const cid = await attachCoverToStoryline(authFetch, 7, file);

    expect(cid).toBe("QmCid");
    expect(calls[0].url).toContain("/api/publish/upload-cover");
    expect(calls[0].body).toBeInstanceOf(FormData);
    expect(calls[1].url).toContain("/api/publish/update-storyline");
    expect(JSON.parse(calls[1].body as string)).toEqual({ storylineId: 7, coverCid: "QmCid" });
  });

  it("returns null and does NOT call update-storyline when the upload fails", async () => {
    const authFetch = vi.fn(() => Promise.resolve(jsonRes(false, { error: "bad" })));
    const cid = await attachCoverToStoryline(authFetch, 7, file);
    expect(cid).toBeNull();
    // only the upload attempt — never update-storyline
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch.mock.calls[0][0]).toContain("/api/publish/upload-cover");
  });

  it("returns null when the upload succeeds but yields no cid", async () => {
    const authFetch = vi.fn(() => Promise.resolve(jsonRes(true, {})));
    const cid = await attachCoverToStoryline(authFetch, 7, file);
    expect(cid).toBeNull();
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when update-storyline fails, even though the cover uploaded", async () => {
    // Cover uploaded but never set on the storyline → not attached, must report
    // failure so the publish flow can surface the non-fatal warning (#284/re1).
    const authFetch = vi.fn((url: string) => {
      if (url.includes("upload-cover")) return Promise.resolve(jsonRes(true, { cid: "QmCid" }));
      return Promise.resolve(jsonRes(false, { error: "not indexed yet" }));
    });
    const cid = await attachCoverToStoryline(authFetch, 7, file);
    expect(cid).toBeNull();
    // both endpoints were attempted
    expect(authFetch).toHaveBeenCalledTimes(2);
    expect(authFetch.mock.calls[1][0]).toContain("/api/publish/update-storyline");
  });
});
