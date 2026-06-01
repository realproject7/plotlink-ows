import { describe, it, expect } from "vitest";
import { getContentTypeForPublish, resolveSelectedContentType } from "./publish-helpers";

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
