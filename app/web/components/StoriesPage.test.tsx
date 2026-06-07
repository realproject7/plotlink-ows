import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import { StoriesPage } from "./StoriesPage";

// Capture props passed to the mocked child panels so tests can drive the
// new-story flow (open modal, expose renameRef) without real terminals.
const childProps = vi.hoisted(() => ({
  onNewStory: null as null | (() => void),
  onSelectFile: null as null | ((storyName: string, fileName: string) => void),
  onSelectStory: null as null | ((name: string) => void),
  renameRef: null as null | {
    current:
      | ((o: string, n: string, meta?: unknown) => Promise<boolean>)
      | null;
  },
  agentProviders: null as null | Record<string, "claude" | "codex">,
  needsProviderRepair: null as null | boolean,
  onRepairProvider: null as null | (() => void | Promise<void>),
  renameCalls: [] as Array<{
    oldName: string;
    newName: string;
    meta?: unknown;
  }>,
  previewStory: undefined as string | null | undefined,
  previewFile: undefined as string | null | undefined,
}));

vi.mock("./StoryBrowser", () => ({
  StoryBrowser: (props: {
    onNewStory: () => void;
    onSelectFile: (s: string, f: string) => void;
  }) => {
    childProps.onNewStory = props.onNewStory;
    childProps.onSelectFile = props.onSelectFile;
    return (
      <button data-testid="mock-new-story" onClick={props.onNewStory}>
        New Story
      </button>
    );
  },
}));

vi.mock("./TerminalPanel", () => ({
  TerminalPanel: (props: {
    renameRef: {
      current:
        | ((o: string, n: string, meta?: unknown) => Promise<boolean>)
        | null;
    };
    agentProviders?: Record<string, "claude" | "codex">;
    needsProviderRepair?: boolean;
    onRepairProvider?: () => void | Promise<void>;
    onSelectStory?: (name: string) => void;
  }) => {
    childProps.renameRef = props.renameRef;
    childProps.onSelectStory = props.onSelectStory ?? null;
    childProps.agentProviders = props.agentProviders ?? null;
    childProps.needsProviderRepair = props.needsProviderRepair ?? null;
    childProps.onRepairProvider = props.onRepairProvider ?? null;
    // Provide a rename implementation so the polling effect proceeds; record the
    // forwarded metadata so tests can assert provider persistence at rename (#295).
    props.renameRef.current = (
      oldName: string,
      newName: string,
      meta?: unknown,
    ) => {
      childProps.renameCalls.push({ oldName, newName, meta });
      return Promise.resolve(true);
    };
    return <div data-testid="mock-terminal" />;
  },
}));

vi.mock("./PreviewPanel", () => ({
  PreviewPanel: (props: {
    storyName?: string | null;
    fileName?: string | null;
    onFocusedLetteringModeChange?: (active: boolean) => void;
    onFocusedLetteringWorkspaceVisibleChange?: (visible: boolean) => void;
  }) => {
    childProps.previewStory = props.storyName;
    childProps.previewFile = props.fileName;
    return (
      <div
        data-testid="mock-preview"
        data-story={props.storyName ?? ""}
        data-file={props.fileName ?? ""}
      >
        <button
          data-testid="mock-enter-focused-lettering"
          onClick={() => props.onFocusedLetteringModeChange?.(true)}
        >
          Enter focused lettering
        </button>
        <button
          data-testid="mock-exit-focused-lettering"
          onClick={() => props.onFocusedLetteringModeChange?.(false)}
        >
          Exit focused lettering
        </button>
        <button
          data-testid="mock-show-work-area"
          onClick={() => props.onFocusedLetteringWorkspaceVisibleChange?.(true)}
        >
          Show work area
        </button>
        <button
          data-testid="mock-hide-work-area"
          onClick={() =>
            props.onFocusedLetteringWorkspaceVisibleChange?.(false)
          }
        >
          Hide work area
        </button>
      </div>
    );
  },
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
  childProps.onSelectStory = null;
  childProps.renameRef = null;
  childProps.agentProviders = null;
  childProps.needsProviderRepair = null;
  childProps.onRepairProvider = null;
  childProps.renameCalls = [];
  childProps.previewStory = undefined;
  childProps.previewFile = undefined;
});

interface FetchCall {
  url: string;
  body: unknown;
}

// authFetch that records every call. /api/stories starts empty, then returns a
// single new story ("my-tale") so the polling effect fires the metadata POST.
function makeAuthFetch(opts?: {
  readiness?: unknown;
  readinessFails?: boolean;
}) {
  // Default: codex installed + image generation enabled -> no cartoon warning.
  const readiness = opts?.readiness ?? {
    claude: { installed: true },
    codex: {
      installed: true,
      version: "codex-cli 0.135.0",
      imageGeneration: "enabled",
      auth: "ok",
    },
    checkedAt: 1748000000000,
  };
  const calls: FetchCall[] = [];
  let storiesAppeared = false;
  const fn = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    let body: unknown;
    try {
      body = opts?.body ? JSON.parse(opts.body as string) : undefined;
    } catch {
      /* ignore */
    }
    calls.push({ url, body });
    if (url === "/api/wallet") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ address: "0xabc" }),
      });
    }
    if (url === "/api/agent/readiness") {
      if (opts?.readinessFails) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve(null),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(readiness),
      });
    }
    if (url === "/api/stories" && !opts) {
      const stories = storiesAppeared
        ? [{ name: "my-tale", hasStructure: false }]
        : [];
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ stories }),
      });
    }
    // Guided New Story create (#423): server returns the named story slug.
    if (url === "/api/stories/create") {
      const b = body as { title?: string; contentType?: string } | undefined;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "my-tale",
            title: b?.title,
            contentType: b?.contentType,
          }),
      });
    }
    // story detail (handleSelectStory), metadata POST, or anything else
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, files: [] }),
    });
  });
  return {
    fn,
    calls,
    appear: () => {
      storiesAppeared = true;
    },
  };
}

describe("StoriesPage new-story provider selection (guided create #423)", () => {
  function createBodyFor(
    calls: FetchCall[],
  ): Record<string, unknown> | undefined {
    return calls.find((c) => c.url === "/api/stories/create")?.body as
      | Record<string, unknown>
      | undefined;
  }

  // Guided flow: open modal → enter a title → pick a content type → the app POSTs
  // /api/stories/create with the chosen metadata (no agent-driven rename).
  async function createStory(opts: {
    provider?: "claude" | "codex";
    contentTypeLabel: "Fiction" | "Cartoon";
    title?: string;
  }) {
    const { fn, calls } = makeAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));

    const select = screen.getByTestId(
      "agent-provider-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("claude");
    if (opts.provider)
      fireEvent.change(select, { target: { value: opts.provider } });

    fireEvent.change(screen.getByTestId("new-story-title"), {
      target: { value: opts.title ?? "My Tale" },
    });
    fireEvent.click(
      screen.getByTestId(
        opts.contentTypeLabel === "Cartoon"
          ? "create-cartoon"
          : "create-fiction",
      ),
    );

    await waitFor(
      () => {
        expect(createBodyFor(calls)).toBeDefined();
      },
      { timeout: 5000 },
    );
    return createBodyFor(calls)!;
  }

  it("creates a cartoon with the entered title + agentProvider codex", async () => {
    const body = await createStory({
      provider: "codex",
      contentTypeLabel: "Cartoon",
      title: "신의 세포",
    });
    expect(body).toMatchObject({
      contentType: "cartoon",
      agentProvider: "codex",
      title: "신의 세포",
    });
  }, 10000);

  it("forces agentProvider 'codex' for cartoon even when the dropdown shows Claude", async () => {
    const body = await createStory({ contentTypeLabel: "Cartoon" });
    expect(body).toMatchObject({
      contentType: "cartoon",
      agentProvider: "codex",
    });
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

  it("requires a title before the create buttons are enabled", () => {
    render(<StoriesPage token="t" authFetch={makeAuthFetch().fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    expect(screen.getByTestId("new-story-title-required")).toBeInTheDocument();
    expect(screen.getByTestId("create-fiction")).toBeDisabled();
    fireEvent.change(screen.getByTestId("new-story-title"), {
      target: { value: "Dusk" },
    });
    expect(screen.getByTestId("create-fiction")).not.toBeDisabled();
  });

  it("defaults agentProvider to 'claude' when the provider control is untouched (fiction)", async () => {
    const body = await createStory({ contentTypeLabel: "Fiction" });
    expect(body).toMatchObject({
      contentType: "fiction",
      agentProvider: "claude",
    });
  }, 10000);

  it("lets fiction opt into Codex via the dropdown", async () => {
    const body = await createStory({
      provider: "codex",
      contentTypeLabel: "Fiction",
    });
    expect(body).toMatchObject({
      contentType: "fiction",
      agentProvider: "codex",
    });
  }, 10000);

  it("threads provider=codex into agentProviders for the created cartoon story", async () => {
    await createStory({ contentTypeLabel: "Cartoon" });
    await waitFor(() => {
      const providers = childProps.agentProviders ?? {};
      expect(providers["my-tale"]).toBe("codex");
      expect(Object.values(providers)).not.toContain("claude");
    });
  }, 10000);

  it("threads provider=claude into agentProviders for the created fiction story", async () => {
    await createStory({ contentTypeLabel: "Fiction" });
    await waitFor(() => {
      expect((childProps.agentProviders ?? {})["my-tale"]).toBe("claude");
    });
  }, 10000);

  it("toggles provider helper text when switching to Codex", () => {
    render(<StoriesPage token="t" authFetch={makeAuthFetch().fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));

    const helper = screen.getByTestId("agent-provider-helper");
    expect(helper.textContent).toContain("Claude prepares image prompts");

    fireEvent.change(screen.getByTestId("agent-provider-select"), {
      target: { value: "codex" },
    });
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
    {
      name: "codex-cartoon",
      hasStructure: true,
      contentType: "cartoon",
      agentProvider: "codex",
    },
    { name: "my-novel", hasStructure: true, contentType: "fiction" },
  ];
  const fn = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    let body: unknown;
    try {
      body = opts?.body ? JSON.parse(opts.body as string) : undefined;
    } catch {
      /* ignore */
    }
    calls.push({ url, body });
    if (url === "/api/wallet") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ address: "0xabc" }),
      });
    }
    if (url === "/api/agent/readiness") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            claude: { installed: true },
            codex: {
              installed: true,
              version: "codex-cli 0.135.0",
              imageGeneration: "enabled",
              auth: "ok",
            },
            checkedAt: 1748000000000,
          }),
      });
    }
    if (url === "/api/stories" && !opts) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ stories }),
      });
    }
    if (url.startsWith("/api/stories/") && !opts) {
      // story detail fetch from handleSelectStory — return no files.
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ files: [] }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
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
    expect(repairCall!.body).toMatchObject({
      contentType: "cartoon",
      agentProvider: "codex",
    });
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

describe("StoriesPage focused cartoon lettering mode (#493)", () => {
  it("collapses the wider work area for focused lettering and can restore it without leaving the editor", async () => {
    render(<StoriesPage token="t" authFetch={makeAuthFetch().fn} />);

    await waitFor(() => expect(childProps.onSelectFile).not.toBeNull());
    childProps.onSelectFile!("cartoon-a", "plot-01.md");
    await screen.findByTestId("mock-preview");

    expect(screen.getByTestId("stories-default-layout")).toBeInTheDocument();
    expect(screen.getByTestId("mock-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("mock-new-story")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-enter-focused-lettering"));

    await waitFor(() =>
      expect(
        screen.getByTestId("stories-focused-lettering-mode"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("mock-terminal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-new-story")).not.toBeInTheDocument();
    expect(screen.getByTestId("mock-preview")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-show-work-area"));

    await waitFor(() =>
      expect(screen.getByTestId("stories-default-layout")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("mock-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("mock-preview")).toBeInTheDocument();
  });
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
        codex: {
          installed: false,
          version: null,
          imageGeneration: "unknown",
          auth: "unknown",
        },
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
        codex: {
          installed: true,
          version: "codex-cli 0.135.0",
          imageGeneration: "disabled",
          auth: "ok",
        },
        checkedAt: 1748000000000,
      },
    });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-warning")).toBeInTheDocument();
    });
    expect(screen.getByTestId("copy-codex-enable")).toBeInTheDocument();
    expect(
      screen.getByText("codex features enable image_generation"),
    ).toBeInTheDocument();
    expect(cartoonButton()).toBeDisabled();
  });

  it("copies the enable command to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { fn } = makeAuthFetch({
      readiness: {
        claude: { installed: true },
        codex: {
          installed: true,
          version: "codex-cli 0.135.0",
          imageGeneration: "disabled",
          auth: "ok",
        },
        checkedAt: 1748000000000,
      },
    });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    await waitFor(() => {
      expect(screen.getByTestId("copy-codex-enable")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("copy-codex-enable"));
    expect(writeText).toHaveBeenCalledWith(
      "codex features enable image_generation",
    );
  });

  it("no warning and Cartoon enabled when codex + image generation are ready", async () => {
    const { fn } = makeAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    fireEvent.change(screen.getByTestId("new-story-title"), {
      target: { value: "A Tale" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-note")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("cartoon-codex-warning"),
    ).not.toBeInTheDocument();
    expect(cartoonButton()).not.toBeDisabled();
  });

  it("shows the distinct auth-unknown message (not the enable-feature one) AND disables Cartoon when codex auth is unclear (#263)", async () => {
    // Codex installed but `features list` unreadable → imageGeneration:unknown +
    // auth:unknown. The actionable next step is a Codex login, not feature-enable.
    const { fn } = makeAuthFetch({
      readiness: {
        claude: { installed: true },
        codex: {
          installed: true,
          version: "codex-cli 0.135.0",
          imageGeneration: "unknown",
          auth: "unknown",
        },
        checkedAt: 1748000000000,
      },
    });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    await waitFor(() => {
      expect(
        screen.getByTestId("cartoon-codex-auth-unknown"),
      ).toBeInTheDocument();
    });
    // The generic enable-feature warning must NOT show in the auth-unclear case.
    expect(
      screen.queryByTestId("cartoon-codex-warning"),
    ).not.toBeInTheDocument();
    expect(cartoonButton()).toBeDisabled();
  });

  it("does NOT disable Cartoon while readiness is unresolved (probe endpoint fails)", async () => {
    const { fn } = makeAuthFetch({ readinessFails: true });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    fireEvent.change(screen.getByTestId("new-story-title"), {
      target: { value: "A Tale" },
    });
    // Note is always present; warning never shows when readiness is null.
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-note")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("cartoon-codex-warning"),
    ).not.toBeInTheDocument();
    expect(cartoonButton()).not.toBeDisabled();
  });

  it("never disables the Fiction create button regardless of codex readiness", async () => {
    const { fn } = makeAuthFetch({
      readiness: {
        claude: { installed: true },
        codex: {
          installed: false,
          version: null,
          imageGeneration: "unknown",
          auth: "unknown",
        },
        checkedAt: 1748000000000,
      },
    });
    render(<StoriesPage token="t" authFetch={fn} />);
    fireEvent.click(screen.getByTestId("mock-new-story"));
    fireEvent.change(screen.getByTestId("new-story-title"), {
      target: { value: "A Tale" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("cartoon-codex-warning")).toBeInTheDocument();
    });
    const fictionBtn = screen
      .getByText("Fiction")
      .closest("button") as HTMLButtonElement;
    expect(fictionBtn).not.toBeDisabled();
  });
});

// Two cartoon stories so we can switch between them. /api/stories carries titles
// for the nav header; story detail returns no auto-open files for cartoon.
function makeTwoCartoonAuthFetch() {
  const stories = [
    {
      name: "cartoon-a",
      title: "Story A",
      hasStructure: true,
      hasGenesis: true,
      contentType: "cartoon",
      agentProvider: "codex",
    },
    {
      name: "cartoon-b",
      title: "Story B",
      hasStructure: true,
      hasGenesis: true,
      contentType: "cartoon",
      agentProvider: "codex",
    },
  ];
  const progress = {
    name: "cartoon-a",
    contentType: "cartoon",
    metadata: {
      title: "Story A",
      language: "English",
      genre: "Science Fiction",
      isNsfw: false,
      contentType: "cartoon",
    },
    setup: { hasStructure: true, hasGenesis: true },
    cover: "missing",
    episodes: [
      {
        file: "genesis.md",
        label: "Episode 1 / Genesis",
        kind: "genesis",
        title: "Opening",
        state: "ready",
        summary: "Ready to publish",
        published: false,
        checklist: [],
        cuts: {
          total: 0,
          needClean: 0,
          withClean: 0,
          withText: 0,
          exported: 0,
          uploaded: 0,
        },
      },
    ],
    summary: {
      episodes: 1,
      published: 0,
      readyToPublish: 1,
      placeholders: 0,
      blocked: 0,
    },
    nextAction: "Add a cover image before publishing.",
    nextPrompt: null,
    coach: null,
  };
  const fn = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url === "/api/wallet")
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ address: "0xabc" }),
      });
    if (url === "/api/agent/readiness") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            claude: { installed: true },
            codex: {
              installed: true,
              version: "codex-cli 0.135.0",
              imageGeneration: "enabled",
              auth: "ok",
            },
            checkedAt: 1748000000000,
          }),
      });
    }
    if (url === "/api/stories" && !opts)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ stories }),
      });
    if (url.endsWith("/progress"))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(progress),
      });
    // story detail (cartoon ⇒ no auto-open) and everything else.
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ contentType: "cartoon", files: [] }),
    });
  });
  return { fn };
}

describe("StoriesPage cartoon workflow nav routing (#439)", () => {
  it("routes file-backed nav tabs to the CURRENT story after a left-tree switch to another story (#445 RE1)", async () => {
    const { fn } = makeTwoCartoonAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    await waitFor(() => expect(childProps.onSelectStory).not.toBeNull());

    // Open story A via the terminal/story selector → latestStoryRef = A.
    childProps.onSelectStory!("cartoon-a");
    // Then open story B's file via the LEFT FILE TREE (handleSelectFile).
    await waitFor(() => expect(childProps.onSelectFile).not.toBeNull());
    childProps.onSelectFile!("cartoon-b", "genesis.md");
    await waitFor(() => expect(childProps.previewStory).toBe("cartoon-b"));

    // The nav now shows story B; clicking Whitepaper must open B's structure.md,
    // not story A's (the stale-ref bug).
    fireEvent.click(screen.getByTestId("nav-tab-whitepaper"));
    await waitFor(() => {
      expect(childProps.previewStory).toBe("cartoon-b");
      expect(childProps.previewFile).toBe("structure.md");
    });

    // Genesis / Publish tabs likewise stay on the current story.
    fireEvent.click(screen.getByTestId("nav-tab-genesis"));
    await waitFor(() => {
      expect(childProps.previewStory).toBe("cartoon-b");
      expect(childProps.previewFile).toBe("genesis.md");
    });
  }, 10000);

  // #449: the Publish tab opens its own readiness page and stays selected,
  // instead of visually routing to the Genesis file view.
  it("Publish tab opens the dedicated publish page and stays on Publish, not Genesis", async () => {
    const { fn } = makeTwoCartoonAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    await waitFor(() => expect(childProps.onSelectStory).not.toBeNull());
    childProps.onSelectStory!("cartoon-a");

    fireEvent.click(await screen.findByTestId("nav-tab-publish"));

    // The dedicated publish page renders; the Publish tab is active; the Genesis
    // file view is NOT shown (no mock-preview, Genesis tab not active).
    await screen.findByTestId("cartoon-publish-page");
    expect(screen.getByTestId("nav-tab-publish")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("nav-tab-genesis")).toHaveAttribute(
      "data-active",
      "false",
    );
    expect(screen.queryByTestId("mock-preview")).not.toBeInTheDocument();
  }, 10000);

  it("shows the Story Info next-action CTA on story-level right-pane pages when cover is missing (#487 RE1)", async () => {
    const { fn } = makeTwoCartoonAuthFetch();
    render(<StoriesPage token="t" authFetch={fn} />);
    await waitFor(() => expect(childProps.onSelectStory).not.toBeNull());
    childProps.onSelectStory!("cartoon-a");

    fireEvent.click(await screen.findByTestId("nav-tab-publish"));
    const publishCta = await screen.findByTestId(
      "workflow-context-next-action",
    );
    expect(
      within(publishCta).getByTestId("story-info-next-action"),
    ).toHaveTextContent(/Next: Add a cover image before publishing/i);
    expect(
      within(publishCta).getByRole("button", { name: "Next Action" }),
    ).toBeInTheDocument();
    expect(
      within(publishCta).queryByText("No next action available"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(publishCta).getByRole("button", { name: "Next Action" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("nav-tab-story-info")).toHaveAttribute(
        "data-active",
        "true",
      ),
    );

    const storyInfoCta = screen.getByTestId("workflow-context-next-action");
    expect(
      within(storyInfoCta).getByTestId("story-info-next-action"),
    ).toHaveTextContent(/Next: Add a cover image before publishing/i);
    expect(
      within(storyInfoCta).queryByText("No next action available"),
    ).not.toBeInTheDocument();
  }, 10000);
});
