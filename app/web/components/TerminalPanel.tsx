import { useRef, useEffect, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  token: string;
  storyName: string | null;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  onSelectStory?: (storyName: string) => void;
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
  white: "#3A2A1E",
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

// Sessions live outside React state to avoid ref-in-effect lint issues
const sessions = new Map<string, TerminalSession>();

export function TerminalPanel({ token, storyName, authFetch, onSelectStory }: TerminalPanelProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const authFetchRef = useRef(authFetch);
  const [sessionList, setSessionList] = useState<string[]>([]);
  const [disconnected, setDisconnected] = useState<Set<string>>(new Set());

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

  const connectWs = useCallback((name: string, session: TerminalSession, resume: boolean) => {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${wsProto}//${window.location.host}/ws/terminal?story=${encodeURIComponent(name)}&token=${token}&resume=${resume}`
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
    wrapperRef.current.appendChild(container);

    const term = new Terminal({
      cols: 80, // Fallback minimum until FitAddon computes actual size
      scrollback: 5000,
      fontSize: 13,
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      lineHeight: 1.2,
      letterSpacing: 0.5,
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

    // Apply padding to term.element so FitAddon measures correctly
    if (term.element) {
      term.element.style.paddingLeft = "10px";
    }

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
  }, [authFetch]);

  // Auto-spawn + show/hide when story changes
  useEffect(() => {
    if (!storyName) return;
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
  }, [storyName, createSession, showSession]);

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
              <span className="truncate max-w-[120px]">{name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  destroySession(name);
                }}
                className="ml-0.5 text-muted hover:text-error text-[10px] leading-none"
                title="Close terminal"
              >
                ×
              </button>
            </div>
          ))
        }
      </div>
      )}

      {/* Terminal containers — always rendered so wrapperRef is available */}
      <div className="relative flex-1 min-h-0">
        <div ref={wrapperRef} className="h-full" />

        {/* Empty state overlay */}
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center text-muted">
            <div className="text-center">
              <p className="text-lg font-serif">Select a story on the left menu</p>
              <p className="text-sm mt-1">to start an AI Writer session</p>
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
