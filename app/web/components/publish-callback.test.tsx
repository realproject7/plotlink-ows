import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { useState, useCallback } from "react";
import { getContentTypeForPublish } from "../lib/publish-helpers";

afterEach(cleanup);

function TestPublishComponent({ authFetch }: { authFetch: (url: string, opts?: RequestInit) => void }) {
  const [storyContentTypes, setStoryContentTypes] = useState<Record<string, string>>({});

  const handlePublish = useCallback((storyName: string, storylineId: number | undefined) => {
    const ct = getContentTypeForPublish(storyContentTypes, storyName, storylineId);
    const payload = { storyName, ...(ct ? { contentType: ct } : {}) };
    authFetch("/api/publish/file", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }, [authFetch, storyContentTypes]);

  return (
    <div>
      <button onClick={() => setStoryContentTypes({ "cartoon-story": "cartoon" })} data-testid="set-cartoon">
        Set Cartoon
      </button>
      <button onClick={() => handlePublish("cartoon-story", undefined)} data-testid="publish-genesis">
        Publish Genesis
      </button>
      <button onClick={() => handlePublish("cartoon-story", 42)} data-testid="publish-plot">
        Publish Plot
      </button>
    </div>
  );
}

describe("StoriesPage.handlePublish dependency array (source guard)", () => {
  it("production handlePublish includes storyContentTypes and walletAddress in deps", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "StoriesPage.tsx"),
      "utf-8",
    );

    const handlePublishMatch = source.match(
      /const handlePublish = useCallback\([\s\S]*?\}, \[([^\]]+)\]\)/,
    );
    expect(handlePublishMatch).toBeTruthy();
    const deps = handlePublishMatch![1];
    expect(deps).toContain("storyContentTypes");
    expect(deps).toContain("walletAddress");
  });
});

describe("publish callback boundary (stale closure regression)", () => {
  it("cartoon genesis includes contentType after metadata update", () => {
    const authFetch = vi.fn();
    render(<TestPublishComponent authFetch={authFetch} />);

    fireEvent.click(screen.getByTestId("publish-genesis"));
    expect(authFetch).toHaveBeenCalledTimes(1);
    const firstPayload = JSON.parse(authFetch.mock.calls[0][1].body);
    expect(firstPayload.contentType).toBeUndefined();

    act(() => { fireEvent.click(screen.getByTestId("set-cartoon")); });

    fireEvent.click(screen.getByTestId("publish-genesis"));
    expect(authFetch).toHaveBeenCalledTimes(2);
    const secondPayload = JSON.parse(authFetch.mock.calls[1][1].body);
    expect(secondPayload.contentType).toBe("cartoon");
  });

  it("cartoon plot omits contentType even after metadata update", () => {
    const authFetch = vi.fn();
    render(<TestPublishComponent authFetch={authFetch} />);

    act(() => { fireEvent.click(screen.getByTestId("set-cartoon")); });
    fireEvent.click(screen.getByTestId("publish-plot"));

    const payload = JSON.parse(authFetch.mock.calls[0][1].body);
    expect(payload.contentType).toBeUndefined();
  });
});
