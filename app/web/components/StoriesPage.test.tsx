import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { StoriesPage } from "./StoriesPage";

// Capture props passed to the mocked child panels so tests can drive the
// new-story flow (open modal, expose renameRef) without real terminals.
const childProps = vi.hoisted(() => ({
  onNewStory: null as null | (() => void),
  renameRef: null as null | { current: ((o: string, n: string) => Promise<boolean>) | null },
}));

vi.mock("./StoryBrowser", () => ({
  StoryBrowser: (props: { onNewStory: () => void }) => {
    childProps.onNewStory = props.onNewStory;
    return <button data-testid="mock-new-story" onClick={props.onNewStory}>New Story</button>;
  },
}));

vi.mock("./TerminalPanel", () => ({
  TerminalPanel: (props: { renameRef: { current: ((o: string, n: string) => Promise<boolean>) | null } }) => {
    childProps.renameRef = props.renameRef;
    // Provide a rename implementation so the polling effect proceeds.
    props.renameRef.current = () => Promise.resolve(true);
    return <div data-testid="mock-terminal" />;
  },
}));

vi.mock("./PreviewPanel", () => ({
  PreviewPanel: () => <div data-testid="mock-preview" />,
}));

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  childProps.onNewStory = null;
  childProps.renameRef = null;
});

interface FetchCall { url: string; body: unknown }

// authFetch that records every call. /api/stories starts empty, then returns a
// single new story ("my-tale") so the polling effect fires the metadata POST.
function makeAuthFetch() {
  const calls: FetchCall[] = [];
  let storiesAppeared = false;
  const fn = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    let body: unknown;
    try { body = opts?.body ? JSON.parse(opts.body as string) : undefined; } catch { /* ignore */ }
    calls.push({ url, body });
    if (url === "/api/wallet") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: "0xabc" }) });
    }
    if (url === "/api/stories" && !opts) {
      const stories = storiesAppeared
        ? [{ name: "my-tale", hasStructure: false }]
        : [];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ stories }) });
    }
    // metadata POST or anything else
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });
  return { fn, calls, appear: () => { storiesAppeared = true; } };
}

function metadataBodyFor(calls: FetchCall[]): Record<string, unknown> | undefined {
  const call = calls.find((c) => c.url.includes("/metadata"));
  return call?.body as Record<string, unknown> | undefined;
}

describe("StoriesPage new-story provider selection", () => {
  async function createStory(opts: { provider?: "claude" | "codex"; contentTypeLabel: string }) {
    const { fn, calls, appear } = makeAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);

    // Open the new-story modal.
    fireEvent.click(screen.getByTestId("mock-new-story"));

    // Provider control defaults to Claude.
    const select = screen.getByTestId("agent-provider-select") as HTMLSelectElement;
    expect(select.value).toBe("claude");
    if (opts.provider) {
      fireEvent.change(select, { target: { value: opts.provider } });
    }

    // Pick a content type → registers the pending session in the maps.
    fireEvent.click(screen.getByText(opts.contentTypeLabel));

    // Now make a story "appear" and let the 3s poll run.
    appear();
    await waitFor(
      () => { expect(metadataBodyFor(calls)).toBeDefined(); },
      { timeout: 5000 },
    );
    return metadataBodyFor(calls)!;
  }

  it("persists agentProvider 'codex' when Codex is selected (cartoon)", async () => {
    const body = await createStory({ provider: "codex", contentTypeLabel: "Cartoon" });
    expect(body).toMatchObject({ contentType: "cartoon", agentProvider: "codex" });
  }, 10000);

  it("defaults agentProvider to 'claude' when the provider control is untouched", async () => {
    const body = await createStory({ contentTypeLabel: "Fiction" });
    expect(body).toMatchObject({ contentType: "fiction", agentProvider: "claude" });
  }, 10000);

  it("toggles provider helper text when switching to Codex", () => {
    render(<StoriesPage token="t" authFetch={makeAuthFetch().fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));

    const helper = screen.getByTestId("agent-provider-helper");
    expect(helper.textContent).toContain("Claude prepares image prompts");

    fireEvent.change(screen.getByTestId("agent-provider-select"), { target: { value: "codex" } });
    expect(screen.getByTestId("agent-provider-helper").textContent).toContain(
      "Codex can generate clean cartoon images",
    );
  });
});
