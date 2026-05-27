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
});
