import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { StoriesPage } from "./StoriesPage";

// Capture props passed to the mocked child panels so tests can drive the
// new-story flow (open modal, expose renameRef) without real terminals.
const childProps = vi.hoisted(() => ({
  onNewStory: null as null | (() => void),
  renameRef: null as null | { current: ((o: string, n: string) => Promise<boolean>) | null },
  agentProviders: null as null | Record<string, "claude" | "codex">,
}));

vi.mock("./StoryBrowser", () => ({
  StoryBrowser: (props: { onNewStory: () => void }) => {
    childProps.onNewStory = props.onNewStory;
    return <button data-testid="mock-new-story" onClick={props.onNewStory}>New Story</button>;
  },
}));

vi.mock("./TerminalPanel", () => ({
  TerminalPanel: (props: {
    renameRef: { current: ((o: string, n: string) => Promise<boolean>) | null };
    agentProviders?: Record<string, "claude" | "codex">;
  }) => {
    childProps.renameRef = props.renameRef;
    childProps.agentProviders = props.agentProviders ?? null;
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
  childProps.agentProviders = null;
});

interface FetchCall { url: string; body: unknown }

// authFetch that records every call. /api/stories starts empty, then returns a
// single new story ("my-tale") so the polling effect fires the metadata POST.
function makeAuthFetch(opts?: { readiness?: unknown }) {
  // Default: codex installed + image generation enabled -> no cartoon warning.
  const readiness = opts?.readiness ?? {
    claude: { installed: true },
    codex: { installed: true, imageGeneration: "enabled" },
  };
  const calls: FetchCall[] = [];
  let storiesAppeared = false;
  const fn = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    let body: unknown;
    try { body = opts?.body ? JSON.parse(opts.body as string) : undefined; } catch { /* ignore */ }
    calls.push({ url, body });
    if (url === "/api/wallet") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: "0xabc" }) });
    }
    if (url === "/api/agent/readiness") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(readiness) });
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

  it("forces agentProvider 'codex' for cartoon even when the dropdown shows Claude", async () => {
    // No provider override → dropdown stays on its Claude default.
    const body = await createStory({ contentTypeLabel: "Cartoon" });
    expect(body).toMatchObject({ contentType: "cartoon", agentProvider: "codex" });
  }, 10000);

  it("explains why cartoon requires Codex while the modal is open", () => {
    render(<StoriesPage token="t" authFetch={makeAuthFetch().fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    expect(
      screen.getByText(
        "Cartoon mode requires Codex because the clean-image step needs image generation support.",
      ),
    ).toBeInTheDocument();
  });

  it("defaults agentProvider to 'claude' when the provider control is untouched (fiction)", async () => {
    const body = await createStory({ contentTypeLabel: "Fiction" });
    expect(body).toMatchObject({ contentType: "fiction", agentProvider: "claude" });
  }, 10000);

  it("lets fiction opt into Codex via the dropdown", async () => {
    const body = await createStory({ provider: "codex", contentTypeLabel: "Fiction" });
    expect(body).toMatchObject({ contentType: "fiction", agentProvider: "codex" });
  }, 10000);

  // Regression for PR #260: the provider must be threaded into the TerminalPanel
  // `agentProviders` state map for the brand-new (_new_) session, so the FIRST
  // WS spawn appends provider=codex. Cartoon is always codex.
  it("threads provider=codex into agentProviders for a new cartoon _new_ session", async () => {
    const { fn } = makeAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    fireEvent.click(screen.getByText("Cartoon"));
    await waitFor(() => {
      const providers = childProps.agentProviders ?? {};
      const entries = Object.entries(providers);
      expect(entries.length).toBeGreaterThan(0);
      // The pending session key is a _new_<ts> id, mapped to codex.
      expect(entries.some(([k, v]) => k.startsWith("_new_") && v === "codex")).toBe(true);
      expect(Object.values(providers)).not.toContain("claude");
    });
  });

  it("threads provider=claude into agentProviders for a default fiction _new_ session", async () => {
    const { fn } = makeAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    fireEvent.click(screen.getByText("Fiction"));
    await waitFor(() => {
      const providers = childProps.agentProviders ?? {};
      expect(Object.entries(providers).some(([k, v]) => k.startsWith("_new_") && v === "claude")).toBe(true);
    });
  });

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

describe("StoriesPage cartoon codex readiness guidance", () => {
  it("warns and keeps Cartoon available when codex is not installed", async () => {
    const { fn } = makeAuthFetch({
      readiness: {
        claude: { installed: true },
        codex: { installed: false, imageGeneration: "unknown" },
      },
    });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-warning")).toBeInTheDocument();
    });
    // Cartoon option is still present (not hard-blocked).
    expect(screen.getByText("Cartoon")).toBeInTheDocument();
  });

  it("shows no warning when codex is installed with image generation enabled", async () => {
    const { fn } = makeAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    // Let the readiness fetch resolve.
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-note")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cartoon-codex-warning")).not.toBeInTheDocument();
  });

  it("shows no hard warning when image generation is unknown", async () => {
    const { fn } = makeAuthFetch({
      readiness: {
        claude: { installed: true },
        codex: { installed: true, imageGeneration: "unknown" },
      },
    });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-note")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cartoon-codex-warning")).not.toBeInTheDocument();
  });
});
