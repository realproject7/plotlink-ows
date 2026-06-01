import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { TerminalPanel, isCartoonLaunchBlocked } from "./TerminalPanel";
import type { AgentReadiness } from "@app-lib/agent-readiness";

// --- Stub the heavy terminal/runtime deps so the panel mounts in jsdom. ---
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    write() {}
    clear() {}
    dispose() {}
    onData() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: class { serialize() { return ""; } },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

function readiness(
  installed: boolean,
  imageGeneration: "enabled" | "disabled" | "unknown",
): AgentReadiness {
  return {
    claude: { installed: true },
    codex: { installed, version: installed ? "codex-cli 0.135.0" : null, imageGeneration },
    checkedAt: 1748000000000,
  };
}

// WebSocket spy: records every construction so tests can assert (no) spawn.
let wsConstructed: string[];

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // Minimal IndexedDB stub: loadScrollback/saveScrollback resolve harmlessly.
  global.indexedDB = {
    open: () => {
      const req: Record<string, unknown> = {};
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => {},
        transaction: () => ({
          objectStore: () => ({
            put: () => {},
            get: () => {
              const r: Record<string, unknown> = {};
              queueMicrotask(() => {
                r.result = null;
                (r.onsuccess as (() => void) | undefined)?.();
              });
              return r;
            },
            delete: () => {},
          }),
          oncomplete: null,
          onerror: null,
        }),
        close: () => {},
      };
      queueMicrotask(() => {
        req.result = db;
        (req.onsuccess as (() => void) | undefined)?.();
      });
      return req;
    },
  } as unknown as IDBFactory;
});

beforeEach(() => {
  wsConstructed = [];
  global.WebSocket = class {
    static OPEN = 1;
    readyState = 0;
    binaryType = "";
    onopen: (() => void) | null = null;
    onmessage: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(url: string) {
      wsConstructed.push(url);
    }
    send() {}
    close() {}
  } as unknown as typeof WebSocket;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const noopFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
});

describe("isCartoonLaunchBlocked", () => {
  it("blocks cartoon when codex not installed", () => {
    expect(isCartoonLaunchBlocked("cartoon", readiness(false, "unknown"))).toBe(true);
  });
  it("blocks cartoon when installed but image generation disabled", () => {
    expect(isCartoonLaunchBlocked("cartoon", readiness(true, "disabled"))).toBe(true);
  });
  it("blocks cartoon when installed but image generation unknown", () => {
    expect(isCartoonLaunchBlocked("cartoon", readiness(true, "unknown"))).toBe(true);
  });
  it("does NOT block cartoon when codex installed + image generation enabled", () => {
    expect(isCartoonLaunchBlocked("cartoon", readiness(true, "enabled"))).toBe(false);
  });
  it("does NOT block cartoon when readiness is null (fail-open)", () => {
    expect(isCartoonLaunchBlocked("cartoon", null)).toBe(false);
  });
  it("does NOT block cartoon when readiness is undefined (fail-open)", () => {
    expect(isCartoonLaunchBlocked("cartoon", undefined)).toBe(false);
  });
  it("never blocks fiction even when codex not ready", () => {
    expect(isCartoonLaunchBlocked("fiction", readiness(false, "unknown"))).toBe(false);
  });
  it("never blocks undefined content type", () => {
    expect(isCartoonLaunchBlocked(undefined, readiness(false, "unknown"))).toBe(false);
  });
});

describe("TerminalPanel cartoon launch gate", () => {
  function renderPanel(props: {
    contentType?: "fiction" | "cartoon";
    readiness?: AgentReadiness | null;
    storyName?: string;
  }) {
    const renameRef = { current: null } as {
      current: ((o: string, n: string) => Promise<boolean>) | null;
    };
    return render(
      <TerminalPanel
        token="t"
        storyName={props.storyName ?? "my-story"}
        authFetch={noopFetch}
        renameRef={renameRef}
        contentType={props.contentType}
        readiness={props.readiness}
      />,
    );
  }

  it("cartoon + codex not installed => no WS spawn, shows blocked panel", async () => {
    renderPanel({ contentType: "cartoon", readiness: readiness(false, "unknown") });
    expect(screen.getByTestId("cartoon-launch-blocked")).toBeInTheDocument();
    // Give any (incorrect) async spawn a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(wsConstructed).toHaveLength(0);
  });

  it("cartoon + image generation disabled => no WS spawn, shows copyable command", async () => {
    renderPanel({ contentType: "cartoon", readiness: readiness(true, "disabled") });
    expect(screen.getByTestId("cartoon-launch-blocked")).toBeInTheDocument();
    expect(screen.getByText("codex features enable image_generation")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(wsConstructed).toHaveLength(0);
  });

  it("cartoon + codex ready => spawns WS, no blocked panel", async () => {
    renderPanel({ contentType: "cartoon", readiness: readiness(true, "enabled") });
    expect(screen.queryByTestId("cartoon-launch-blocked")).not.toBeInTheDocument();
    await waitFor(() => expect(wsConstructed.length).toBeGreaterThan(0));
    expect(wsConstructed[0]).toContain("/ws/terminal");
  });

  it("cartoon + readiness null => spawns WS (fail-open), no blocked panel", async () => {
    renderPanel({ contentType: "cartoon", readiness: null });
    expect(screen.queryByTestId("cartoon-launch-blocked")).not.toBeInTheDocument();
    await waitFor(() => expect(wsConstructed.length).toBeGreaterThan(0));
  });

  it("fiction + codex not installed => spawns WS (fiction never gated)", async () => {
    renderPanel({ contentType: "fiction", readiness: readiness(false, "unknown") });
    expect(screen.queryByTestId("cartoon-launch-blocked")).not.toBeInTheDocument();
    await waitFor(() => expect(wsConstructed.length).toBeGreaterThan(0));
  });

  // #264: a freshly-created _new_* cartoon draft (not yet persisted) must be
  // gated just like a persisted cartoon story — its content type now reaches
  // TerminalPanel via the pending-draft fallback in StoriesPage.
  it("NEW cartoon draft (_new_*) + codex not ready => no WS spawn, blocked panel", async () => {
    renderPanel({
      storyName: "_new_1730000000000",
      contentType: "cartoon",
      readiness: readiness(false, "unknown"),
    });
    expect(screen.getByTestId("cartoon-launch-blocked")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(wsConstructed).toHaveLength(0);
  });

  it("NEW fiction draft (_new_*) + codex not installed => spawns WS (never gated)", async () => {
    renderPanel({
      storyName: "_new_1730000000001",
      contentType: "fiction",
      readiness: readiness(false, "unknown"),
    });
    expect(screen.queryByTestId("cartoon-launch-blocked")).not.toBeInTheDocument();
    await waitFor(() => expect(wsConstructed.length).toBeGreaterThan(0));
  });
});
