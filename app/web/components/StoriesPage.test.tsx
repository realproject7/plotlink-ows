import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { StoriesPage } from "./StoriesPage";

// Capture props passed to the mocked child panels so tests can drive the
// new-story flow (open modal, expose renameRef) without real terminals.
const childProps = vi.hoisted(() => ({
  onNewStory: null as null | (() => void),
  onSelectFile: null as null | ((storyName: string, fileName: string) => void),
  renameRef: null as null | { current: ((o: string, n: string, meta?: unknown) => Promise<boolean>) | null },
  agentProviders: null as null | Record<string, "claude" | "codex">,
  needsProviderRepair: null as null | boolean,
  onRepairProvider: null as null | (() => void | Promise<void>),
  renameCalls: [] as Array<{ oldName: string; newName: string; meta?: unknown }>,
}));

vi.mock("./StoryBrowser", () => ({
  StoryBrowser: (props: { onNewStory: () => void; onSelectFile: (s: string, f: string) => void }) => {
    childProps.onNewStory = props.onNewStory;
    childProps.onSelectFile = props.onSelectFile;
    return <button data-testid="mock-new-story" onClick={props.onNewStory}>New Story</button>;
  },
}));

vi.mock("./TerminalPanel", () => ({
  TerminalPanel: (props: {
    renameRef: { current: ((o: string, n: string, meta?: unknown) => Promise<boolean>) | null };
    agentProviders?: Record<string, "claude" | "codex">;
    needsProviderRepair?: boolean;
    onRepairProvider?: () => void | Promise<void>;
  }) => {
    childProps.renameRef = props.renameRef;
    childProps.agentProviders = props.agentProviders ?? null;
    childProps.needsProviderRepair = props.needsProviderRepair ?? null;
    childProps.onRepairProvider = props.onRepairProvider ?? null;
    // Provide a rename implementation so the polling effect proceeds; record the
    // forwarded metadata so tests can assert provider persistence at rename (#295).
    props.renameRef.current = (oldName: string, newName: string, meta?: unknown) => {
      childProps.renameCalls.push({ oldName, newName, meta });
      return Promise.resolve(true);
    };
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
  childProps.onSelectFile = null;
  childProps.renameRef = null;
  childProps.agentProviders = null;
  childProps.needsProviderRepair = null;
  childProps.onRepairProvider = null;
  childProps.renameCalls = [];
});

interface FetchCall { url: string; body: unknown }

// authFetch that records every call. /api/stories starts empty, then returns a
// single new story ("my-tale") so the polling effect fires the metadata POST.
function makeAuthFetch(opts?: { readiness?: unknown; readinessFails?: boolean }) {
  // Default: codex installed + image generation enabled -> no cartoon warning.
  const readiness = opts?.readiness ?? {
    claude: { installed: true },
    codex: { installed: true, version: "codex-cli 0.135.0", imageGeneration: "enabled", auth: "ok" },
    checkedAt: 1748000000000,
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
      if (opts?.readinessFails) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
      }
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

  // #295: when the agent's folder appears and the _new_ session is renamed, the
  // rename call must forward the cartoon story's metadata (incl. agentProvider:
  // codex) so the server persists it atomically — the fresh-cartoon repair-banner fix.
  it("forwards contentType:cartoon + agentProvider:codex to the rename on confirm", async () => {
    const { fn, appear } = makeAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    fireEvent.click(screen.getByText("Cartoon"));

    appear(); // agent's folder ("my-tale") now shows in /api/stories → triggers rename
    await waitFor(
      () => { expect(childProps.renameCalls.length).toBeGreaterThan(0); },
      { timeout: 5000 },
    );
    const call = childProps.renameCalls.find((c) => c.newName === "my-tale");
    expect(call).toBeDefined();
    expect(call!.oldName.startsWith("_new_")).toBe(true);
    expect(call!.meta).toMatchObject({ contentType: "cartoon", agentProvider: "codex" });
  }, 10000);

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

// authFetch whose /api/stories list contains a legacy cartoon (no
// agentProvider), a codex cartoon, and a fiction story, so repair wiring can be
// asserted. Records calls for inspecting the repair metadata POST body.
function makeListAuthFetch() {
  const calls: FetchCall[] = [];
  const stories = [
    { name: "legacy-cartoon", hasStructure: true, contentType: "cartoon" },
    { name: "codex-cartoon", hasStructure: true, contentType: "cartoon", agentProvider: "codex" },
    { name: "my-novel", hasStructure: true, contentType: "fiction" },
  ];
  const fn = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    let body: unknown;
    try { body = opts?.body ? JSON.parse(opts.body as string) : undefined; } catch { /* ignore */ }
    calls.push({ url, body });
    if (url === "/api/wallet") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ address: "0xabc" }) });
    }
    if (url === "/api/agent/readiness") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          claude: { installed: true },
          codex: { installed: true, version: "codex-cli 0.135.0", imageGeneration: "enabled", auth: "ok" },
          checkedAt: 1748000000000,
        }),
      });
    }
    if (url === "/api/stories" && !opts) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ stories }) });
    }
    if (url.startsWith("/api/stories/") && !opts) {
      // story detail fetch from handleSelectStory — return no files.
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });
  return { fn, calls };
}

describe("StoriesPage legacy cartoon provider repair wiring", () => {
  it("passes needsProviderRepair=true for a selected legacy cartoon and the repair POSTs codex", async () => {
    const { fn, calls } = makeListAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);

    // Wait for the list to populate state.
    await waitFor(() => expect(childProps.onSelectFile).not.toBeNull());

    // Select the legacy cartoon (no agentProvider recorded).
    childProps.onSelectFile!("legacy-cartoon", "structure.md");

    await waitFor(() => expect(childProps.needsProviderRepair).toBe(true));

    // Invoke the repair callback the panel would call.
    await childProps.onRepairProvider!();

    const repairCall = calls.find(
      (c) => c.url === "/api/stories/legacy-cartoon/metadata",
    );
    expect(repairCall).toBeDefined();
    expect(repairCall!.body).toMatchObject({ contentType: "cartoon", agentProvider: "codex" });
  }, 10000);

  it("does NOT flag repair for a cartoon that already has codex", async () => {
    const { fn } = makeListAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    await waitFor(() => expect(childProps.onSelectFile).not.toBeNull());

    childProps.onSelectFile!("codex-cartoon", "structure.md");
    // Give state a tick; needsProviderRepair must stay false.
    await new Promise((r) => setTimeout(r, 30));
    expect(childProps.needsProviderRepair).toBe(false);
  }, 10000);

  it("does NOT flag repair for a fiction story", async () => {
    const { fn } = makeListAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    await waitFor(() => expect(childProps.onSelectFile).not.toBeNull());

    childProps.onSelectFile!("my-novel", "structure.md");
    await new Promise((r) => setTimeout(r, 30));
    expect(childProps.needsProviderRepair).toBe(false);
  }, 10000);
});

function cartoonButton(): HTMLButtonElement {
  // The Cartoon create button is the <button> whose label text is "Cartoon".
  return screen.getByText("Cartoon").closest("button") as HTMLButtonElement;
}

describe("StoriesPage cartoon codex readiness gating", () => {
  it("warns AND disables Cartoon create when codex is not installed", async () => {
    const { fn } = makeAuthFetch({
      readiness: {
        claude: { installed: true },
        codex: { installed: false, version: null, imageGeneration: "unknown", auth: "unknown" },
        checkedAt: 1748000000000,
      },
    });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-warning")).toBeInTheDocument();
    });
    expect(cartoonButton()).toBeDisabled();
  });

  it("shows copy-enable command AND disables Cartoon when image generation is disabled", async () => {
    const { fn } = makeAuthFetch({
      readiness: {
        claude: { installed: true },
        codex: { installed: true, version: "codex-cli 0.135.0", imageGeneration: "disabled", auth: "ok" },
        checkedAt: 1748000000000,
      },
    });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-warning")).toBeInTheDocument();
    });
    expect(screen.getByTestId("copy-codex-enable")).toBeInTheDocument();
    expect(screen.getByText("codex features enable image_generation")).toBeInTheDocument();
    expect(cartoonButton()).toBeDisabled();
  });

  it("copies the enable command to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { fn } = makeAuthFetch({
      readiness: {
        claude: { installed: true },
        codex: { installed: true, version: "codex-cli 0.135.0", imageGeneration: "disabled", auth: "ok" },
        checkedAt: 1748000000000,
      },
    });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    await waitFor(() => {
      expect(screen.getByTestId("copy-codex-enable")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("copy-codex-enable"));
    expect(writeText).toHaveBeenCalledWith("codex features enable image_generation");
  });

  it("no warning and Cartoon enabled when codex + image generation are ready", async () => {
    const { fn } = makeAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-note")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cartoon-codex-warning")).not.toBeInTheDocument();
    expect(cartoonButton()).not.toBeDisabled();
  });

  it("shows the distinct auth-unknown message (not the enable-feature one) AND disables Cartoon when codex auth is unclear (#263)", async () => {
    // Codex installed but `features list` unreadable → imageGeneration:unknown +
    // auth:unknown. The actionable next step is a Codex login, not feature-enable.
    const { fn } = makeAuthFetch({
      readiness: {
        claude: { installed: true },
        codex: { installed: true, version: "codex-cli 0.135.0", imageGeneration: "unknown", auth: "unknown" },
        checkedAt: 1748000000000,
      },
    });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-auth-unknown")).toBeInTheDocument();
    });
    // The generic enable-feature warning must NOT show in the auth-unclear case.
    expect(screen.queryByTestId("cartoon-codex-warning")).not.toBeInTheDocument();
    expect(cartoonButton()).toBeDisabled();
  });

  it("does NOT disable Cartoon while readiness is unresolved (probe endpoint fails)", async () => {
    const { fn } = makeAuthFetch({ readinessFails: true });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    // Note is always present; warning never shows when readiness is null.
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-note")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cartoon-codex-warning")).not.toBeInTheDocument();
    expect(cartoonButton()).not.toBeDisabled();
  });

  it("never disables the Fiction create button regardless of codex readiness", async () => {
    const { fn } = makeAuthFetch({
      readiness: {
        claude: { installed: true },
        codex: { installed: false, version: null, imageGeneration: "unknown", auth: "unknown" },
        checkedAt: 1748000000000,
      },
    });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-warning")).toBeInTheDocument();
    });
    const fictionBtn = screen.getByText("Fiction").closest("button") as HTMLButtonElement;
    expect(fictionBtn).not.toBeDisabled();
  });
});
