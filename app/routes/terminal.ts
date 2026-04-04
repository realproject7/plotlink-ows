import { Hono } from "hono";
import pty from "node-pty";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORIES_DIR = path.join(__dirname, "..", "..", "stories");

const terminal = new Hono();

// Active PTY sessions keyed by session ID
const ptySessions = new Map<
  string,
  { term: pty.IPty; ws: WebSocket | null; state: "running" | "stopped" }
>();

/** POST /api/terminal/spawn — spawn Claude CLI in stories/ */
terminal.post("/spawn", (c) => {
  const sessionId = "default";

  const existing = ptySessions.get(sessionId);
  if (existing?.term && existing.state === "running") {
    return c.json({ ok: true, pid: existing.term.pid, reused: true });
  }

  try {
    const term = pty.spawn("claude", [], {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: STORIES_DIR,
      env: process.env as Record<string, string>,
    });

    ptySessions.set(sessionId, { term, ws: null, state: "running" });

    term.onExit(({ exitCode }) => {
      const session = ptySessions.get(sessionId);
      if (session?.term === term) {
        session.state = "stopped";
        if (session.ws && session.ws.readyState <= 1) {
          session.ws.close(1000, `exited:${exitCode}`);
        }
        session.ws = null;
      }
    });

    return c.json({ ok: true, pid: term.pid });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to spawn PTY";
    return c.json({ ok: false, error: message }, 500);
  }
});

/** POST /api/terminal/stop — kill PTY */
terminal.post("/stop", (c) => {
  const session = ptySessions.get("default");
  if (session?.term && session.state === "running") {
    session.term.kill();
    session.state = "stopped";
    return c.json({ ok: true });
  }
  return c.json({ ok: true, message: "not running" });
});

/** GET /api/terminal/status */
terminal.get("/status", (c) => {
  const session = ptySessions.get("default");
  return c.json({
    running: session?.state === "running",
    pid: session?.term?.pid ?? null,
  });
});

/**
 * Attach a raw WebSocket to the PTY session.
 * Called from server.ts WebSocket upgrade handler.
 */
export function attachTerminalWs(ws: WebSocket) {
  const sessionId = "default";
  let session = ptySessions.get(sessionId);

  // Lazy spawn if no PTY exists
  if (!session || session.state !== "running") {
    try {
      const term = pty.spawn("claude", [], {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: STORIES_DIR,
        env: process.env as Record<string, string>,
      });

      session = { term, ws: null, state: "running" };
      ptySessions.set(sessionId, session);

      term.onExit(({ exitCode }) => {
        const s = ptySessions.get(sessionId);
        if (s?.term === term) {
          s.state = "stopped";
          if (s.ws && s.ws.readyState <= 1) {
            s.ws.close(1000, `exited:${exitCode}`);
          }
          s.ws = null;
        }
      });
    } catch {
      ws.close(1011, "pty-spawn-failed");
      return;
    }
  }

  // Replace previous WS
  if (session.ws && session.ws !== ws && session.ws.readyState <= 1) {
    session.ws.close(1000, "replaced");
  }
  session.ws = ws;

  // PTY output → browser
  const dataDisposable = session.term.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Browser input → PTY
  ws.addEventListener("message", (event: MessageEvent) => {
    if (!session?.term || session.state !== "running") return;
    const str = typeof event.data === "string" ? event.data : event.data.toString();
    try {
      const parsed = JSON.parse(str);
      if (parsed.type === "resize" && parsed.cols && parsed.rows) {
        session.term.resize(parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON — raw input
    }
    session.term.write(str);
  });

  // Cleanup on close (keep PTY running)
  ws.addEventListener("close", () => {
    dataDisposable.dispose();
    if (session?.ws === ws) {
      session.ws = null;
    }
  });
}

export { terminal as terminalRoutes };
