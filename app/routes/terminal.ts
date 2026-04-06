import { Hono } from "hono";
import * as pty from "node-pty";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORIES_DIR = path.join(__dirname, "..", "..", "stories");
const MAX_SESSIONS = 5;

const terminal = new Hono();

// Active PTY sessions keyed by story name
const ptySessions = new Map<
  string,
  { term: pty.IPty; ws: WebSocket | null; state: "running" | "stopped" }
>();

function safeName(name: string): string | null {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
    return null;
  }
  return name;
}

function spawnPty(storyName: string) {
  const storyDir = path.join(STORIES_DIR, storyName);
  const shell = process.env.SHELL || "/bin/zsh";
  const term = pty.spawn(shell, ["-l", "-c", `claude --cwd "${storyDir}"`], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: storyDir,
    env: process.env as Record<string, string>,
  });

  const session = { term, ws: null as WebSocket | null, state: "running" as const };
  ptySessions.set(storyName, session);

  term.onExit(({ exitCode }) => {
    const s = ptySessions.get(storyName);
    if (s?.term === term) {
      s.state = "stopped";
      if (s.ws && s.ws.readyState <= 1) {
        s.ws.close(1000, `exited:${exitCode}`);
      }
      s.ws = null;
    }
  });

  return session;
}

/** POST /api/terminal/spawn — spawn Claude CLI for a story */
terminal.post("/spawn", async (c) => {
  const body = await c.req.json<{ storyName?: string }>().catch(() => ({}));
  const storyName = safeName(body.storyName || "default");
  if (!storyName) return c.json({ error: "Invalid story name" }, 400);

  const existing = ptySessions.get(storyName);
  if (existing?.term && existing.state === "running") {
    return c.json({ ok: true, pid: existing.term.pid, storyName, reused: true });
  }

  // Enforce max concurrent sessions
  const running = [...ptySessions.values()].filter((s) => s.state === "running").length;
  if (running >= MAX_SESSIONS) {
    return c.json({ error: `Max ${MAX_SESSIONS} concurrent sessions`, ok: false }, 429);
  }

  try {
    const session = spawnPty(storyName);
    return c.json({ ok: true, pid: session.term.pid, storyName });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to spawn PTY";
    return c.json({ ok: false, error: message }, 500);
  }
});

/** DELETE /api/terminal/:storyName — kill a story's PTY */
terminal.delete("/:storyName", (c) => {
  const storyName = safeName(c.req.param("storyName"));
  if (!storyName) return c.json({ error: "Invalid story name" }, 400);

  const session = ptySessions.get(storyName);
  if (session?.term && session.state === "running") {
    session.term.kill();
    session.state = "stopped";
    ptySessions.delete(storyName);
    return c.json({ ok: true });
  }
  ptySessions.delete(storyName);
  return c.json({ ok: true, message: "not running" });
});

/** POST /api/terminal/stop — kill PTY (legacy, kills default) */
terminal.post("/stop", (c) => {
  const session = ptySessions.get("default");
  if (session?.term && session.state === "running") {
    session.term.kill();
    session.state = "stopped";
    return c.json({ ok: true });
  }
  return c.json({ ok: true, message: "not running" });
});

/** GET /api/terminal/status — list all sessions */
terminal.get("/status", (c) => {
  const sessions: Record<string, { running: boolean; pid: number | null }> = {};
  for (const [name, session] of ptySessions) {
    sessions[name] = {
      running: session.state === "running",
      pid: session.term?.pid ?? null,
    };
  }
  return c.json({ sessions });
});

/**
 * Attach a raw WebSocket to a story's PTY session.
 * Called from server.ts WebSocket upgrade handler.
 */
export function attachTerminalWs(ws: WebSocket, storyName?: string) {
  const name = storyName && safeName(storyName) ? storyName : "default";
  let session = ptySessions.get(name);

  // Lazy spawn if no PTY exists
  if (!session || session.state !== "running") {
    // Enforce max concurrent sessions
    const running = [...ptySessions.values()].filter((s) => s.state === "running").length;
    if (running >= MAX_SESSIONS) {
      ws.close(1013, "max-sessions");
      return;
    }

    try {
      session = spawnPty(name);
    } catch (err) {
      console.error("PTY spawn failed:", err);
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
