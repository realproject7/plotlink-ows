import { useRef, useEffect, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  token: string;
}

export function TerminalPanel({ token }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const connect = useCallback(() => {
    if (!containerRef.current) return;

    // Initialize terminal
    const term = new Terminal({
      scrollback: 5000,
      fontSize: 13,
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      lineHeight: 1.4,
      letterSpacing: 0.5,
      cursorBlink: true,
      cursorStyle: "block",
      theme: {
        background: "#F0EBE1",
        foreground: "#2C1810",
        cursor: "#8B4513",
        cursorAccent: "#F0EBE1",
        selectionBackground: "#D4C5B0",
        selectionForeground: "#2C1810",
        black: "#2C1810",
        red: "#CC3333",
        green: "#5B7A2E",
        yellow: "#8B6914",
        blue: "#4A6FA5",
        magenta: "#7B4B8A",
        cyan: "#4A8B8B",
        white: "#2C1810",
        brightBlack: "#8B7355",
        brightRed: "#E04040",
        brightGreen: "#6B8F38",
        brightYellow: "#A07D1C",
        brightBlue: "#5A82BA",
        brightMagenta: "#8E5D9F",
        brightCyan: "#5A9F9F",
        brightWhite: "#4A3728",
      },
      allowTransparency: false,
      drawBoldTextInBrightColors: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitRef.current = fitAddon;
    termRef.current = term;

    // Fit after a frame
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });

    // WebSocket connection
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProto}//${window.location.host}/ws/terminal?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (e) => {
      term.write(e.data);
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[33m[Terminal disconnected]\x1b[0m\r\n");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Resize observer
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch { /* ignore */ }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      ws.close();
      term.dispose();
    };
  }, [token]);

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1.5 border-b border-border text-xs text-muted font-mono flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-600" />
        Claude CLI
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
