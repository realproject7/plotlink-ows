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

  // #331: a headingless genesis.md must not publish as the bare "genesis"
  // filename. handlePublish must derive the title via derivePublishTitle and
  // fetch structure.md for genesis (so its H1 can stand in), not use the old
  // `fileName.replace(".md", "")` fallback.
  it("derives the publish title via derivePublishTitle and reads structure.md for genesis", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "StoriesPage.tsx"), "utf-8");
    expect(source).toContain("derivePublishTitle");
    // genesis fetches structure.md so its title can stand in for a missing H1.
    expect(source).toMatch(/genesis\.md[\s\S]*?structure\.md/);
    // The old bare-filename fallback is gone.
    expect(source).not.toContain('fileName.replace(".md", "")');
  });

  // #347: cartoon plot publishes must resolve a real episode title — handlePublish
  // reads the cut plan's title and passes contentType + episodeTitle to
  // derivePublishTitle so a headingless cartoon plot never publishes as "plot-NN".
  it("reads the cut-plan episode title for a cartoon plot publish", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "StoriesPage.tsx"), "utf-8");
    // Fetches cuts.json for a cartoon plot to read its title.
    expect(source).toMatch(/cartoon[\s\S]*?\/cuts\//);
    expect(source).toContain("episodeTitle");
    // Passes contentType + episodeTitle into the title derivation.
    expect(source).toMatch(/derivePublishTitle\(\{[\s\S]*?contentType[\s\S]*?episodeTitle[\s\S]*?\}\)/);
  });

  // #332: handlePublish must guard against minting a duplicate chainPlot for a
  // plot that already has an on-chain chapter (incl. the edit-then-republish
  // path where status was reset to pending but txHash/plotIndex were retained).
  it("guards plot publish against duplicate chainPlot via shouldBlockDuplicatePlotPublish", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "StoriesPage.tsx"), "utf-8");
    expect(source).toContain("shouldBlockDuplicatePlotPublish(fileData)");
    // The guard returns early before reaching the publish SSE call.
    const guardIdx = source.indexOf("shouldBlockDuplicatePlotPublish(fileData)");
    const publishIdx = source.indexOf('authFetch("/api/publish/file"');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(publishIdx);
  });

  // #332: the duplicate-risk "Retry Publish" (mints a new chainPlot) must be
  // gated behind an explicit confirm so it can't be clicked instead of the
  // non-minting "Retry Index" recovery.
  it("gates the Retry Publish button behind an explicit duplicate-risk confirm", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "PreviewPanel.tsx"), "utf-8");
    const btnIdx = source.indexOf('data-testid="retry-publish-btn"');
    expect(btnIdx).toBeGreaterThan(-1);
    // Its onClick window.confirm warns about a duplicate/second chapter.
    const onClick = source.slice(source.lastIndexOf("onClick", btnIdx), btnIdx);
    expect(onClick).toContain("window.confirm");
    expect(onClick).toMatch(/duplicate|second|new on-chain/i);
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
