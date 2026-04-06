import { useRef, useEffect, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  token: string;
  storyName: string | null;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
}

interface TerminalSession {
  term: Terminal;
  fit: FitAddon;
  ws: WebSocket;
  container: HTMLDivElement;
  observer: ResizeObserver;
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
  brightRed: "rgba(180, 80, 80, 0.25)",
  brightGreen: "rgba(76, 140, 76, 0.25)",
  brightYellow: "#A07D1C",
  brightBlue: "#5A82BA",
  brightMagenta: "#8E5D9F",
  brightCyan: "#5A8F8F",
  brightWhite: "#4A3728",
};

// Sessions live outside React state to avoid ref-in-effect lint issues
const sessions = new Map<string, TerminalSession>();

export function TerminalPanel({ token, storyName, authFetch }: TerminalPanelProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [sessionList, setSessionList] = useState<string[]>([]);

  const showSession = useCallback((name: string | null) => {
    for (const [key, session] of sessions) {
      session.container.style.display = key === name ? "block" : "none";
    }
    if (name) {
      const active = sessions.get(name);
      if (active) {
        requestAnimationFrame(() => {
          try { active.fit.fit(); } catch { /* ignore */ }
        });
      }
    }
  }, []);

  const createSession = useCallback((name: string) => {
    if (!wrapperRef.current || sessions.has(name)) return;

    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.display = "none";
    wrapperRef.current.appendChild(container);

    const term = new Terminal({
      scrollback: 5000,
      fontSize: 13,
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      lineHeight: 1.4,
      letterSpacing: 0.5,
      cursorBlink: true,
      cursorStyle: "block",
      theme: THEME,
      allowTransparency: true,
      drawBoldTextInBrightColors: false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${wsProto}//${window.location.host}/ws/terminal?story=${encodeURIComponent(name)}&token=${token}`
    );

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (e) => {
      term.write(e.data);
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[33m[Terminal disconnected]\x1b[0m\r\n");
      // Clean up dead session so it can be recreated
      const dead = sessions.get(name);
      if (dead?.ws === ws) {
        dead.observer.disconnect();
        dead.term.dispose();
        dead.container.remove();
        sessions.delete(name);
        setSessionList((prev) => prev.filter((s) => s !== name));
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch { /* ignore */ }
    });
    observer.observe(container);

    sessions.set(name, { term, fit, ws, container, observer });
    setSessionList((prev) => [...prev, name]);

    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* ignore */ }
    });
  }, [token]);

  const destroySession = useCallback((name: string) => {
    const session = sessions.get(name);
    if (!session) return;
    session.observer.disconnect();
    session.ws.close();
    session.term.dispose();
    session.container.remove();
    sessions.delete(name);
    setSessionList((prev) => prev.filter((s) => s !== name));

    authFetch(`/api/terminal/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {});
  }, [authFetch]);

  // Auto-spawn + show/hide when story changes
  useEffect(() => {
    if (!storyName) return;
    if (!sessions.has(storyName)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- spawn session on story select
      createSession(storyName);
    }
    showSession(storyName);
  }, [storyName, createSession, showSession]);

  // Cleanup all sessions on unmount — also kill server PTYs
  useEffect(() => {
    return () => {
      for (const [name, session] of sessions) {
        session.observer.disconnect();
        session.ws.close();
        session.term.dispose();
        session.container.remove();
        // Fire-and-forget DELETE to kill server PTY
        fetch(`/api/terminal/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {});
      }
      sessions.clear();
    };
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Session tabs */}
      <div className="px-2 py-1 border-b border-border flex items-center gap-1 overflow-x-auto">
        {sessionList.length === 0 ? (
          <span className="text-xs text-muted font-mono px-1">Select a story to start a terminal</span>
        ) : (
          sessionList.map((name) => (
            <div
              key={name}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono ${
                name === storyName
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${name === storyName ? "bg-green-600" : "bg-muted/50"}`} />
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
        )}
      </div>

      {/* Terminal containers */}
      <div ref={wrapperRef} className="flex-1 min-h-0" />
    </div>
  );
}
