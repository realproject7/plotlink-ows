import { useRef, useEffect, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import { isCodexAuthUnclear, CODEX_AUTH_UNCLEAR_MESSAGE, type AgentReadiness } from "@app-lib/agent-readiness";

/** Story metadata persisted with a `_new_*` → real-folder rename (#295). */
export interface RenameMeta {
  contentType?: "fiction" | "cartoon";
  language?: string;
  agentMode?: "normal" | "bypass";
  agentProvider?: "claude" | "codex";
}

interface TerminalPanelProps {
  token: string;
  storyName: string | null;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  onSelectStory?: (storyName: string) => void;
  onDestroySession?: (storyName: string) => void;
  onArchiveStory?: (storyName: string) => void;
  confirmedStories?: Set<string>;
  // The optional `meta` is persisted to the confirmed story's .story.json
  // atomically with the rename so a fresh story's provider/contentType survive (#295).
  renameRef?: React.RefObject<((oldName: string, newName: string, meta?: RenameMeta) => Promise<boolean>) | null>;
  bypassStories?: Record<string, boolean>;
  agentProviders?: Record<string, "claude" | "codex">;
  /** Local agent (Codex) readiness. null/undefined = not yet loaded (fail-open). */
  readiness?: AgentReadiness | null;
  /** Content type of the currently-selected story (undefined = unknown). */
  contentType?: "fiction" | "cartoon";
  /**
   * True only for the selected real (non-`_new_*`) cartoon story whose
   * `.story.json` has no `agentProvider` recorded (legacy). When true, show the
   * explicit provider-repair CTA instead of auto-spawning, so the writer sets
   * the provider to Codex before launching. Never true for fiction or a cartoon
   * that already has a provider.
   */
  needsProviderRepair?: boolean;
  /** Set this story's provider to Codex (scoped, non-destructive repair). */
  onRepairProvider?: () => void | Promise<void>;
}

const CODEX_ENABLE_CMD = "codex features enable image_generation";

/**
 * Pure predicate: should the cartoon agent LAUNCH be blocked?
 *
 * Blocked ONLY when ALL of:
 *  - the selected story is a cartoon, AND
 *  - readiness has loaded (non-null), AND
 *  - Codex is NOT ready (not installed OR image generation not enabled).
 *
 * Fail-open: readiness null/undefined => NOT blocked (a probe failure must never
 * brick terminals). Fiction / undefined contentType => NEVER blocked.
 */
export function isCartoonLaunchBlocked(
  contentType: "fiction" | "cartoon" | undefined,
  readiness: AgentReadiness | null | undefined,
): boolean {
  if (contentType !== "cartoon") return false;
  if (!readiness) return false; // fail-open until readiness resolves
  const codexReady =
    readiness.codex.installed && readiness.codex.imageGeneration === "enabled";
  return !codexReady;
}

interface TerminalSession {
  term: Terminal;
  fit: FitAddon;
  serialize: SerializeAddon;
  ws: WebSocket | null;
  container: HTMLDivElement;
  observer: ResizeObserver;
  connected: boolean;
  _retried?: boolean;
}

const THEME = {
  background: "#F0EBE1",
  foreground: "#2C1810",
  cursor: "#8B4513",
  cursorAccent: "#F0EBE1",
  selectionBackground: "#D4C5B0",
  selectionForeground: "#2C1810",
  black: "#2C1810",
  red: "#A63D40",
  green: "#4A7A4A",
  yellow: "#8B6914",
  blue: "#4A6FA5",
  magenta: "#7B4B8A",
  cyan: "#3D7A7A",
  white: "#E6DDD0",       // subtle cream tint for input line backgrounds
  brightBlack: "#8B7355",
  brightRed: "#B85C5C",   // muted red — readable as text, soft as diff bg
  brightGreen: "#5A8A5A", // muted green — readable as text, soft as diff bg
  brightYellow: "#A07D1C",
  brightBlue: "#5A82BA",
  brightMagenta: "#8E5D9F",
  brightCyan: "#5A8F8F",
  brightWhite: "#4A3728",
};

const DB_NAME = "plotlink-terminal";
const DB_VERSION = 1;
const STORE_NAME = "scrollback";
const MAX_SCROLLBACK_BYTES = 10 * 1024 * 1024; // 10MB per story

// ---- IndexedDB helpers ----
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveScrollback(storyName: string, data: string): Promise<void> {
  // Enforce size limit
  const trimmed = data.length > MAX_SCROLLBACK_BYTES ? data.slice(-MAX_SCROLLBACK_BYTES) : data;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(trimmed, storyName);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function loadScrollback(storyName: string): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(storyName);
    req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function deleteScrollback(storyName: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(storyName);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// Sessions live outside React state to avoid ref-in-effect lint issues
const sessions = new Map<string, TerminalSession>();

export function TerminalPanel({ token, storyName, authFetch, onSelectStory, onDestroySession, onArchiveStory, confirmedStories, renameRef, bypassStories, agentProviders, readiness, contentType, needsProviderRepair, onRepairProvider }: TerminalPanelProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const authFetchRef = useRef(authFetch);
  const [sessionList, setSessionList] = useState<string[]>([]);
  const [disconnected, setDisconnected] = useState<Set<string>>(new Set());
  const [confirmingDiscard, setConfirmingDiscard] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState<string | null>(null);
  const [copiedEnableCmd, setCopiedEnableCmd] = useState(false);
  const [repairing, setRepairing] = useState(false);

  // Gate the cartoon agent launch for the currently-selected story.
  const cartoonLaunchBlocked = isCartoonLaunchBlocked(contentType, readiness);
  // Legacy cartoon (no provider recorded) ⇒ require explicit provider repair
  // before auto-spawning a terminal. Scoped to the selected story only.
  const showProviderRepair = !!needsProviderRepair;

  const connectWsRef = useRef<(name: string, session: TerminalSession, resume: boolean) => void>(() => {});

  useEffect(() => { authFetchRef.current = authFetch; }, [authFetch]);

  const safeFit = useCallback((session: TerminalSession) => {
    const { width } = session.container.getBoundingClientRect();
    if (width < 50) return; // Skip fit if container has no real dimensions
    try {
      session.fit.fit();
      if (session.ws?.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({ type: "resize", cols: session.term.cols, rows: session.term.rows }));
      }
    } catch { /* ignore */ }
  }, []);

  const showSession = useCallback((name: string | null) => {
    for (const [key, session] of sessions) {
      session.container.style.display = key === name ? "block" : "none";
    }
    if (name) {
      const active = sessions.get(name);
      if (active) {
        // setTimeout gives browser time to compute layout after display change
        setTimeout(() => safeFit(active), 50);
      }
    }
  }, [safeFit]);

  const bypassRef = useRef<Record<string, boolean>>({});
  useEffect(() => { bypassRef.current = bypassStories || {}; }, [bypassStories]);

  const providerRef = useRef<Record<string, "claude" | "codex">>({});
  useEffect(() => { providerRef.current = agentProviders || {}; }, [agentProviders]);

  const connectWs = useCallback((name: string, session: TerminalSession, resume: boolean) => {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const bypass = bypassRef.current[name] ? "&bypass=true" : "";
    const provider = providerRef.current[name];
    const providerParam = provider ? `&provider=${encodeURIComponent(provider)}` : "";
    const ws = new WebSocket(
      `${wsProto}//${window.location.host}/ws/terminal?story=${encodeURIComponent(name)}&token=${token}&resume=${resume}${bypass}${providerParam}`
    );

    ws.onopen = () => {
      session.connected = true;
      session._retried = false;
      setDisconnected((prev) => { const next = new Set(prev); next.delete(name); return next; });
      ws.send(JSON.stringify({ type: "resize", cols: session.term.cols, rows: session.term.rows }));
    };

    ws.onmessage = (e) => {
      session.term.write(e.data);
    };

    ws.onclose = (event) => {
      session.connected = false;
      if (session.ws === ws) {
        session.ws = null;
        // Save scrollback before marking disconnected
        try {
          const data = session.serialize.serialize();
          saveScrollback(name, data).catch(() => {});
        } catch { /* ignore */ }

        // Code 4000 = resume failed, auto-reconnect fresh (once only)
        if (event.code === 4000 && !session._retried) {
          session._retried = true;
          session.term.write("\r\n\x1b[33m[Resume failed — starting fresh session...]\x1b[0m\r\n");
          connectWsRef.current(name, session, false);
          return;
        }

        setDisconnected((prev) => new Set(prev).add(name));
      }
    };

    session.term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    session.ws = ws;
  }, [token]);

  useEffect(() => { connectWsRef.current = connectWs; }, [connectWs]);

  const createSession = useCallback(async (name: string, opts?: { resume?: boolean; autoConnect?: boolean }) => {
    if (!wrapperRef.current || sessions.has(name)) return;
    const { resume = false, autoConnect = true } = opts ?? {};

    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.display = "none";
    container.style.paddingLeft = "10px";
    container.style.boxSizing = "border-box";
    wrapperRef.current.appendChild(container);

    const term = new Terminal({
      cols: 80, // Fallback minimum until FitAddon computes actual size
      scrollback: 5000,
      fontSize: 13,
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      lineHeight: 1.05,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "block",
      theme: THEME,
      allowTransparency: false,
      drawBoldTextInBrightColors: false,
      minimumContrastRatio: 7, // High contrast — compensates for dim text halving
    });

    const fit = new FitAddon();
    const serialize = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(serialize);
    term.open(container);

    const session: TerminalSession = { term, fit, serialize, ws: null, container, observer: null as unknown as ResizeObserver, connected: false };

    const observer = new ResizeObserver(() => {
      const { width } = container.getBoundingClientRect();
      if (width < 50) return; // Skip if container not yet laid out
      try {
        fit.fit();
        if (session.ws?.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch { /* ignore */ }
    });
    observer.observe(container);
    session.observer = observer;
    sessions.set(name, session);
    setSessionList((prev) => [...prev, name]);

    // Restore scrollback from IndexedDB
    try {
      const saved = await loadScrollback(name);
      if (saved) {
        term.write(saved);
      }
    } catch { /* ignore */ }

    if (autoConnect) {
      connectWs(name, session, resume);
    } else {
      // Show as disconnected so overlay appears
      setDisconnected((prev) => new Set(prev).add(name));
    }

    // Defer initial fit — container may still be display:none
    setTimeout(() => safeFit(session), 50);
  }, [connectWs, safeFit]);

  const reconnectSession = useCallback(async (name: string, resume: boolean) => {
    const session = sessions.get(name);
    if (!session) return;

    // Close existing WS if any
    if (session.ws) {
      session.ws.close();
      session.ws = null;
    }

    if (!resume) {
      // Kill old server PTY so a fresh one spawns on reconnect
      await authFetchRef.current(`/api/terminal/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {});
      session.term.clear();
    }

    connectWs(name, session, resume);
  }, [connectWs]);

  const destroySession = useCallback((name: string) => {
    const session = sessions.get(name);
    if (!session) return;

    // Save scrollback before destroying
    try {
      const data = session.serialize.serialize();
      saveScrollback(name, data).catch(() => {});
    } catch { /* ignore */ }

    session.observer.disconnect();
    if (session.ws) session.ws.close();
    session.term.dispose();
    session.container.remove();
    sessions.delete(name);
    setSessionList((prev) => prev.filter((s) => s !== name));
    setDisconnected((prev) => { const next = new Set(prev); next.delete(name); return next; });

    authFetch(`/api/terminal/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {});
    onDestroySession?.(name);
  }, [authFetch, onDestroySession]);

  /** Discard an untitled session: send exit, kill PTY, delete scrollback & session metadata */
  const discardSession = useCallback((name: string) => {
    const session = sessions.get(name);
    if (!session) return;

    // Send exit command gracefully before killing
    if (session.ws?.readyState === WebSocket.OPEN) {
      session.ws.send("exit\n");
    }

    // Delete scrollback instead of saving
    deleteScrollback(name).catch(() => {});

    session.observer.disconnect();
    if (session.ws) session.ws.close();
    session.term.dispose();
    session.container.remove();
    sessions.delete(name);
    setSessionList((prev) => prev.filter((s) => s !== name));
    setDisconnected((prev) => { const next = new Set(prev); next.delete(name); return next; });

    // Use discard endpoint to kill PTY and clean up session metadata
    authFetch(`/api/terminal/${encodeURIComponent(name)}/discard`, { method: "DELETE" }).catch(() => {});
    onDestroySession?.(name);
  }, [authFetch, onDestroySession]);

  /** Rename a session key (e.g. _new_123 → paper-chair) without killing the PTY.
   *  Returns true on success, false on failure. */
  const renameSession = useCallback(async (oldName: string, newName: string, meta?: RenameMeta): Promise<boolean> => {
    const session = sessions.get(oldName);
    if (!session || sessions.has(newName)) return false;

    // Rename on the server first. Forward the confirmed story's metadata so the
    // server persists contentType/provider atomically with the rename (#295).
    const res = await authFetchRef.current("/api/terminal/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldName, newName, ...(meta ?? {}) }),
    });
    if (!res.ok) return false;

    // Move in client-side sessions map
    sessions.delete(oldName);
    sessions.set(newName, session);

    // Migrate scrollback under the new key
    try {
      const data = session.serialize.serialize();
      await deleteScrollback(oldName);
      await saveScrollback(newName, data);
    } catch { /* ignore */ }

    // Update React state
    setSessionList((prev) => prev.map((s) => (s === oldName ? newName : s)));
    setDisconnected((prev) => {
      if (!prev.has(oldName)) return prev;
      const next = new Set(prev);
      next.delete(oldName);
      next.add(newName);
      return next;
    });

    // #377: the renamed session's live PTY keeps the cwd it was SPAWNED in, so
    // after the story folder moves (e.g. _new_* → final, or a partial slug →
    // full title) the agent's trust prompt / working directory still points at
    // the old (now-renamed) folder — confusing, and the old folder may no longer
    // exist. If this session is live, move the terminal into the FINAL folder:
    // kill the stale-cwd PTY and reconnect WITH RESUME, so the new spawn runs in
    // stories/<newName> (correct cwd/trust prompt) while the conversation is
    // preserved (claude --resume / codex resume). The server reads the provider
    // from the .story.json it just persisted, so the respawn stays provider-aware.
    // If resume can't recover, the existing code-4000 path reconnects fresh in
    // the same (correct) folder. A never-connected session needs no respawn — its
    // first connect already uses the final name.
    if (session.connected || session.ws) {
      await authFetchRef.current(`/api/terminal/${encodeURIComponent(newName)}`, { method: "DELETE" }).catch(() => {});
      if (session.ws) { session.ws.close(); session.ws = null; }
      connectWsRef.current(newName, session, true);
    }

    return true;
  }, []);

  // Expose renameSession to parent via ref
  useEffect(() => {
    if (renameRef) renameRef.current = renameSession;
    return () => { if (renameRef) renameRef.current = null; };
  }, [renameRef, renameSession]);

  // Auto-spawn + show/hide when story changes
  useEffect(() => {
    if (!storyName) return;
    // Cartoon readiness gate: never spawn/connect a terminal for a cartoon
    // story whose Codex/image_generation is known-not-ready. Show guidance
    // instead (rendered below). Fail-open when readiness is null/undefined.
    if (cartoonLaunchBlocked) {
      showSession(null);
      return;
    }
    // Legacy cartoon with no recorded provider: do NOT auto-spawn. Show the
    // explicit repair CTA so the writer sets the provider to Codex first. After
    // repair, `needsProviderRepair` flips false and normal gating/launch applies.
    if (showProviderRepair) {
      showSession(null);
      return;
    }
    if (!sessions.has(storyName)) {
      // Check if a previous session exists — if so, show overlay instead of auto-connecting
      authFetchRef.current(`/api/terminal/session/${encodeURIComponent(storyName)}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (!sessions.has(storyName)) { // guard against race
            const hasStoredSession = data?.sessionId && !data?.running;
            createSession(storyName, { autoConnect: !hasStoredSession });
            showSession(storyName);
          }
        })
        .catch(() => {
          if (!sessions.has(storyName)) {
            createSession(storyName);
            showSession(storyName);
          }
        });
    } else {
      showSession(storyName);
    }
  }, [storyName, createSession, showSession, cartoonLaunchBlocked, showProviderRepair]);

  // Periodic scrollback save (every 30s for active session)
  useEffect(() => {
    const interval = setInterval(() => {
      for (const [name, session] of sessions) {
        if (session.connected) {
          try {
            const data = session.serialize.serialize();
            saveScrollback(name, data).catch(() => {});
          } catch { /* ignore */ }
        }
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup all sessions on unmount
  useEffect(() => {
    return () => {
      for (const [name, session] of sessions) {
        // Save scrollback before cleanup
        try {
          const data = session.serialize.serialize();
          saveScrollback(name, data).catch(() => {});
        } catch { /* ignore */ }
        session.observer.disconnect();
        if (session.ws) session.ws.close();
        session.term.dispose();
        session.container.remove();
        authFetchRef.current(`/api/terminal/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {});
      }
      sessions.clear();
    };
  }, []);

  const isDisconnected = storyName ? disconnected.has(storyName) : false;
  const isEmpty = sessionList.length === 0;

  return (
    <div className="h-full flex flex-col">
      {/* Session tabs — hidden when no sessions */}
      {!isEmpty && (
      <div className="px-2 py-1 border-b border-border flex items-center gap-1 overflow-x-auto">
        {sessionList.map((name) => (
            <div
              key={name}
              onClick={() => onSelectStory?.(name)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono cursor-pointer ${
                name === storyName
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                disconnected.has(name) ? "bg-amber-500" : name === storyName ? "bg-green-600" : "bg-muted/50"
              }`} />
              <span className={`truncate max-w-[120px] ${name.startsWith("_new_") ? "italic" : ""}`}>
                {name.startsWith("_new_") ? "Untitled" : name}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (name.startsWith("_new_")) {
                    setConfirmingDiscard(name);
                  } else {
                    destroySession(name);
                  }
                }}
                className="ml-0.5 text-muted hover:text-error text-[10px] leading-none"
                title="Close terminal"
              >
                ×
              </button>
            </div>
          ))
        }
        {/* Cancel button for untitled / Archive button for confirmed stories */}
        {storyName?.startsWith("_new_") ? (
          <button
            onClick={() => setConfirmingDiscard(storyName)}
            className="ml-auto px-2 py-0.5 text-xs text-error hover:bg-surface rounded flex items-center gap-1 flex-shrink-0"
          >
            Cancel ×
          </button>
        ) : storyName && onArchiveStory && confirmedStories?.has(storyName) ? (
          <button
            onClick={() => setConfirmingArchive(storyName)}
            className="ml-auto px-2 py-0.5 text-xs text-muted hover:text-foreground hover:bg-surface rounded flex items-center gap-1 flex-shrink-0"
          >
            Archive
          </button>
        ) : null}
      </div>
      )}

      {/* Terminal containers — always rendered so wrapperRef is available */}
      <div className="relative flex-1 min-h-0">
        <div ref={wrapperRef} className="h-full" />

        {/* Empty state overlay */}
        {isEmpty && !cartoonLaunchBlocked && !showProviderRepair && (
          <div className="absolute inset-0 flex items-center justify-center text-muted">
            <div className="text-center">
              <p className="text-lg font-serif">Select a story on the left menu</p>
              <p className="text-sm mt-1">to start an AI Writer session</p>
            </div>
          </div>
        )}

        {/* Cartoon launch gated: Codex / image generation not ready */}
        {cartoonLaunchBlocked && (
          <div
            data-testid="cartoon-launch-blocked"
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(240, 235, 225, 0.9)" }}
          >
            <div className="space-y-3 p-6 bg-surface border border-border rounded-lg shadow-lg max-w-md">
              <p className="text-sm font-serif text-foreground font-medium">
                Cartoon agent can&apos;t launch yet
              </p>
              <p className="text-xs text-muted">
                This is a cartoon story. The writing agent needs Codex with image
                generation enabled before it can start, because the clean-image
                step relies on image generation support.
              </p>
              {readiness && !readiness.codex.installed ? (
                <p className="text-xs text-amber-700">
                  Codex was not detected. Install the Codex CLI and sign in
                  (e.g. <span className="font-mono">npm i -g @openai/codex</span> then{" "}
                  <span className="font-mono">codex login</span>), then reopen this story.
                </p>
              ) : isCodexAuthUnclear(readiness) ? (
                <p className="text-xs text-amber-700" data-testid="codex-auth-unknown-launch">
                  {CODEX_AUTH_UNCLEAR_MESSAGE} Then reopen this story.
                </p>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-amber-700">
                    Codex is installed but image generation isn&apos;t enabled. Enable
                    it, then reopen this story:
                  </p>
                  <div className="flex items-center gap-1">
                    <code className="flex-1 truncate rounded border border-border bg-surface px-1.5 py-1 text-left text-[10px] font-mono text-foreground">
                      {CODEX_ENABLE_CMD}
                    </code>
                    <button
                      type="button"
                      data-testid="copy-codex-enable-launch"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(CODEX_ENABLE_CMD);
                          setCopiedEnableCmd(true);
                          setTimeout(() => setCopiedEnableCmd(false), 2000);
                        } catch { /* clipboard unavailable */ }
                      }}
                      className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:border-accent hover:text-accent transition-colors"
                    >
                      {copiedEnableCmd ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Legacy cartoon: no provider recorded — explicit, scoped repair CTA.
            Separate from readiness gating; about a MISSING provider on this one
            story. Setting it to Codex never touches other stories or fiction. */}
        {showProviderRepair && !cartoonLaunchBlocked && (
          <div
            data-testid="legacy-cartoon-provider-repair"
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(240, 235, 225, 0.9)" }}
          >
            <div className="space-y-3 p-6 bg-surface border border-border rounded-lg shadow-lg max-w-md">
              <p className="text-sm font-serif text-foreground font-medium">
                Set this cartoon story&apos;s provider
              </p>
              <p className="text-xs text-muted">
                This cartoon story was created before provider tracking, so it has
                no provider recorded and would launch with Claude — which can&apos;t
                generate the clean images cartoons need. Set this story&apos;s
                provider to Codex to continue.
              </p>
              <p className="text-[11px] text-muted">
                Only this story is changed. Other stories and fiction are not affected.
              </p>
              <button
                type="button"
                data-testid="repair-provider-codex"
                disabled={repairing}
                onClick={async () => {
                  if (repairing) return;
                  setRepairing(true);
                  try {
                    await onRepairProvider?.();
                  } finally {
                    setRepairing(false);
                  }
                }}
                className="px-4 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {repairing ? "Setting…" : "Set this story's provider to Codex"}
              </button>
            </div>
          </div>
        )}

        {/* Discard confirmation overlay */}
        {confirmingDiscard && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: "rgba(240, 235, 225, 0.9)" }}>
            <div className="text-center space-y-3 p-6 bg-surface border border-border rounded-lg shadow-lg max-w-sm">
              <p className="text-sm font-serif text-foreground font-medium">Discard this session?</p>
              <p className="text-xs text-muted">
                This session will be lost — your AI hasn&apos;t created a story structure yet.
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setConfirmingDiscard(null)}
                  className="px-4 py-1.5 border border-border text-sm rounded hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const name = confirmingDiscard;
                    setConfirmingDiscard(null);
                    discardSession(name);
                  }}
                  className="px-4 py-1.5 bg-error text-white text-sm rounded hover:opacity-80"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Archive confirmation overlay */}
        {confirmingArchive && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: "rgba(240, 235, 225, 0.9)" }}>
            <div className="text-center space-y-3 p-6 bg-surface border border-border rounded-lg shadow-lg max-w-sm">
              <p className="text-sm font-serif text-foreground font-medium">Archive this story?</p>
              <p className="text-xs text-muted">
                You can restore it later from the Archives view.
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setConfirmingArchive(null)}
                  className="px-4 py-1.5 border border-border text-sm rounded hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const name = confirmingArchive;
                    setConfirmingArchive(null);
                    try {
                      const res = await authFetchRef.current("/api/stories/archive", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name }),
                      });
                      if (res.ok) {
                        destroySession(name);
                        onArchiveStory?.(name);
                      }
                    } catch { /* ignore */ }
                  }}
                  className="px-4 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-dim"
                >
                  Archive
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reconnect overlay */}
        {isDisconnected && storyName && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(240, 235, 225, 0.9)" }}>
            <div className="text-center space-y-3">
              <p className="text-sm font-serif text-foreground">Terminal disconnected</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => reconnectSession(storyName, true)}
                  className="px-4 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-dim"
                >
                  Resume Session
                </button>
                <button
                  onClick={() => reconnectSession(storyName, false)}
                  className="px-4 py-1.5 border border-border text-sm rounded hover:bg-surface"
                >
                  Start Fresh
                </button>
              </div>
              <p className="text-xs text-muted">Resume continues your previous Claude conversation</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
