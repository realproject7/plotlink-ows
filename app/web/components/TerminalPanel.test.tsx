import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { TerminalPanel, isCartoonLaunchBlocked } from "./TerminalPanel";
import type { AgentReadiness } from "@app-lib/agent-readiness";
import { FRESH_SPAWN_SIGNAL } from "@app-lib/terminal-protocol";

// --- Stub the heavy terminal/runtime deps so the panel mounts in jsdom. ---
// Records term.write/reset so the #453 fresh-spawn-dedup test can assert behavior.
const termSpy = vi.hoisted(() => ({ writes: [] as unknown[], resets: 0 }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    write(data: unknown) { termSpy.writes.push(data); }
    clear() {}
    reset() { termSpy.resets++; }
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
  // Realistic default: imageGeneration:"unknown" only arises when `features list`
  // can't be read, i.e. auth is unclear; otherwise auth is "ok".
  auth: "ok" | "unknown" = imageGeneration === "unknown" ? "unknown" : "ok",
): AgentReadiness {
  return {
    claude: { installed: true },
    codex: { installed, version: installed ? "codex-cli 0.135.0" : null, imageGeneration, auth },
    checkedAt: 1748000000000,
  };
}

// WebSocket spy: records every construction so tests can assert (no) spawn.
let wsConstructed: string[];
// Captures each WebSocket instance + the IndexedDB scrollback deletes for the
// #453 fresh-spawn-dedup test.
let wsInstances: Array<{ readyState: number; onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null }>;
const idbDeletes = vi.hoisted(() => ({ keys: [] as unknown[] }));

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
        transaction: () => {
          const tx: Record<string, unknown> = {
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
              delete: (key: unknown) => { idbDeletes.keys.push(key); },
            }),
            oncomplete: null,
            onerror: null,
          };
          // Resolve the transaction so saveScrollback/deleteScrollback (which
          // await tx.oncomplete) don't hang — needed once rename exercises them.
          queueMicrotask(() => { (tx.oncomplete as (() => void) | undefined)?.(); });
          return tx;
        },
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
  wsInstances = [];
  termSpy.writes = [];
  termSpy.resets = 0;
  idbDeletes.keys = [];
  global.WebSocket = class {
    static OPEN = 1;
    readyState = 0;
    binaryType = "";
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(url: string) {
      wsConstructed.push(url);
      wsInstances.push(this as never);
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
    // Auth is OK here, so the auth-unclear message must NOT appear.
    expect(screen.queryByTestId("codex-auth-unknown-launch")).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(wsConstructed).toHaveLength(0);
  });

  it("cartoon + codex installed but auth unclear => distinct login message, NOT the enable-feature command (#263)", async () => {
    renderPanel({ contentType: "cartoon", readiness: readiness(true, "unknown") });
    expect(screen.getByTestId("cartoon-launch-blocked")).toBeInTheDocument();
    expect(screen.getByTestId("codex-auth-unknown-launch")).toBeInTheDocument();
    // The enable-feature command must NOT be shown for an auth-unclear state.
    expect(screen.queryByText("codex features enable image_generation")).not.toBeInTheDocument();
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

describe("TerminalPanel legacy cartoon provider repair", () => {
  function renderPanel(props: {
    needsProviderRepair?: boolean;
    onRepairProvider?: () => void | Promise<void>;
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
        storyName={props.storyName ?? "my-cartoon"}
        authFetch={noopFetch}
        renameRef={renameRef}
        contentType={props.contentType ?? "cartoon"}
        readiness={props.readiness ?? readiness(true, "enabled")}
        needsProviderRepair={props.needsProviderRepair}
        onRepairProvider={props.onRepairProvider}
      />,
    );
  }

  it("shows the repair panel and button when needsProviderRepair is true, and does NOT spawn", async () => {
    renderPanel({ needsProviderRepair: true });
    expect(screen.getByTestId("legacy-cartoon-provider-repair")).toBeInTheDocument();
    expect(screen.getByTestId("repair-provider-codex")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(wsConstructed).toHaveLength(0);
  });

  it("clicking the repair button calls onRepairProvider", async () => {
    const onRepairProvider = vi.fn().mockResolvedValue(undefined);
    renderPanel({ needsProviderRepair: true, onRepairProvider });
    screen.getByTestId("repair-provider-codex").click();
    await waitFor(() => expect(onRepairProvider).toHaveBeenCalledTimes(1));
  });

  it("does NOT show the repair panel for fiction", () => {
    renderPanel({ needsProviderRepair: false, contentType: "fiction", storyName: "my-novel" });
    expect(screen.queryByTestId("legacy-cartoon-provider-repair")).not.toBeInTheDocument();
  });

  it("does NOT show the repair panel for a cartoon that already has a provider", async () => {
    renderPanel({ needsProviderRepair: false });
    expect(screen.queryByTestId("legacy-cartoon-provider-repair")).not.toBeInTheDocument();
    // Normal cartoon (codex ready) auto-spawns.
    await waitFor(() => expect(wsConstructed.length).toBeGreaterThan(0));
  });
});

// #377: renaming a live story (e.g. _new_* → final, or a partial slug → full
// title) must move the terminal into the FINAL folder so the agent's trust
// prompt / cwd reflect it — the live PTY keeps its spawn cwd otherwise. The
// rename respawns with resume so the conversation is preserved.
describe("TerminalPanel rename moves the terminal into the final folder (#377)", () => {
  it("kills the stale-cwd PTY and reconnects the renamed story WITH RESUME", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const authFetch = vi.fn((url: string, opts?: RequestInit) => {
      calls.push({ url, method: opts?.method ?? "GET" });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    const renameRef = { current: null } as {
      current: ((o: string, n: string) => Promise<boolean>) | null;
    };
    render(
      <TerminalPanel
        token="t"
        storyName="paper-chair"
        authFetch={authFetch}
        renameRef={renameRef}
        contentType="fiction"
        readiness={null}
      />,
    );

    // Auto-spawn opens the initial WS for the current story (resume=false).
    await waitFor(() => expect(wsConstructed.some((u) => u.includes("story=paper-chair"))).toBe(true), { timeout: 2000 });
    const before = wsConstructed.length;
    expect(renameRef.current).toBeTruthy();

    await act(async () => {
      await renameRef.current!("paper-chair", "paper-chair-at-dawn");
    });

    // The stale PTY is killed and a fresh WS is opened for the FINAL folder,
    // resuming so the brainstorm is preserved.
    await waitFor(() => {
      expect(
        calls.some((c) => c.method === "DELETE" && c.url.includes("/api/terminal/paper-chair-at-dawn")),
      ).toBe(true);
      expect(
        wsConstructed.some((u) => u.includes("story=paper-chair-at-dawn") && u.includes("resume=true")),
      ).toBe(true);
    });
    expect(wsConstructed.length).toBeGreaterThan(before);
  });
});

describe("TerminalPanel fresh-spawn scrollback dedup (#453)", () => {
  function renderPanel(storyName: string) {
    const renameRef = { current: null } as { current: ((o: string, n: string) => Promise<boolean>) | null };
    return render(
      <TerminalPanel token="t" storyName={storyName} authFetch={noopFetch} renameRef={renameRef} />,
    );
  }

  it("drops the restored scrollback when the server signals a fresh spawn, then writes later frames", async () => {
    renderPanel("god-cell");
    await waitFor(() => expect(wsInstances.length).toBeGreaterThan(0));
    const ws = wsInstances[wsInstances.length - 1];
    act(() => { ws.readyState = 1; ws.onopen?.(); });

    // First frame is the fresh-spawn control → reset the terminal + drop the
    // persisted scrollback, and do NOT write the signal itself.
    act(() => { ws.onmessage?.({ data: FRESH_SPAWN_SIGNAL }); });
    expect(termSpy.resets).toBe(1);
    // deleteScrollback resolves through the async IndexedDB stub.
    await waitFor(() => expect(idbDeletes.keys).toContain("god-cell"));
    expect(termSpy.writes).not.toContain(FRESH_SPAWN_SIGNAL);

    // Subsequent PTY frames are written normally.
    act(() => { ws.onmessage?.({ data: "agent banner output" }); });
    expect(termSpy.writes).toContain("agent banner output");
  });

  it("keeps a live reconnect (no signal) — writes the first frame, no reset, no scrollback drop", async () => {
    renderPanel("tidewright");
    await waitFor(() => expect(wsInstances.length).toBeGreaterThan(0));
    const ws = wsInstances[wsInstances.length - 1];
    act(() => { ws.readyState = 1; ws.onopen?.(); });

    // A live reconnect's first frame is ordinary PTY output — kept as-is.
    act(() => { ws.onmessage?.({ data: "live pty output" }); });
    expect(termSpy.resets).toBe(0);
    expect(termSpy.writes).toContain("live pty output");
    expect(idbDeletes.keys).not.toContain("tidewright");
  });
});
