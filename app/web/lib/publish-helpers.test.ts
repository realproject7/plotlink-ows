import { describe, it, expect } from "vitest";
import { getContentTypeForPublish } from "./publish-helpers";

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
