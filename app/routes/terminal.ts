import { Hono } from "hono";
import * as pty from "node-pty";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { STORIES_DIR, DATA_DIR } from "../lib/paths";

const MAX_SESSIONS = 5;
const SESSION_FILE = path.join(DATA_DIR, "terminal-sessions.json");

const terminal = new Hono();

// Active PTY sessions keyed by story name
const ptySessions = new Map<
  string,
  { term: pty.IPty; ws: WebSocket | null; state: "running" | "stopped"; sessionId: string }
>();

function safeName(name: string): string | null {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
    return null;
  }
  return name;
}

/** Load stored session UUIDs from disk */
function loadSessionMap(): Record<string, string> {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

/** Save session UUIDs to disk */
function saveSessionMap(map: Record<string, string>) {
  try {
    const dir = path.dirname(SESSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(map, null, 2) + "\n");
  } catch { /* ignore */ }
}

function spawnPty(storyName: string, opts?: { sessionId?: string; resume?: boolean }) {
  const storyDir = path.join(STORIES_DIR, storyName);
  if (!fs.existsSync(storyDir)) fs.mkdirSync(storyDir, { recursive: true });
  const shell = process.env.SHELL || "/bin/zsh";

  // Determine session ID
  const sessionMap = loadSessionMap();
  let sessionId: string;

  // Build Claude CLI command with session flags
  // Note: no --cwd flag — Claude CLI uses process cwd, set via pty.spawn({ cwd: storyDir })
  let claudeCmd = "claude";
  if (opts?.resume && sessionMap[storyName]) {
    // Resume: reuse stored session
    sessionId = sessionMap[storyName];
    claudeCmd += ` --resume "${sessionId}"`;
  } else {
    // Fresh: always generate new UUID
    sessionId = opts?.sessionId || randomUUID();
    claudeCmd += ` --session-id "${sessionId}"`;
  }

  const term = pty.spawn(shell, ["-l", "-c", claudeCmd], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: storyDir,
    env: process.env as Record<string, string>,
  });

  // Persist session ID
  sessionMap[storyName] = sessionId;
  saveSessionMap(sessionMap);

  const isResume = !!opts?.resume;
  const spawnTime = Date.now();
  const session = { term, ws: null as WebSocket | null, state: "running" as const, sessionId };
  ptySessions.set(storyName, session);

  term.onExit(({ exitCode }) => {
    const s = ptySessions.get(storyName);
    if (s?.term !== term) return;

    // If a resumed session exits quickly (< 5s), signal client to auto-reconnect fresh
    const elapsed = Date.now() - spawnTime;
    if (isResume && elapsed < 5000 && exitCode !== 0) {
      console.log(`Resume for "${storyName}" failed (exit ${exitCode} in ${elapsed}ms), signaling fresh fallback`);
      ptySessions.delete(storyName);
      if (s.ws && s.ws.readyState <= 1) {
        // Close code 4000 = resume-failed, client should auto-reconnect fresh
        s.ws.close(4000, "resume-failed");
      }
      s.ws = null;
      return;
    }

    s.state = "stopped";
    if (s.ws && s.ws.readyState <= 1) {
      s.ws.close(1000, `exited:${exitCode}`);
    }
    s.ws = null;
  });

  return session;
}

/** POST /api/terminal/spawn — spawn Claude CLI for a story */
terminal.post("/spawn", async (c) => {
  const body = await c.req.json<{ storyName?: string; resume?: boolean }>().catch(() => ({}));
  const storyName = safeName(body.storyName || "default");
  if (!storyName) return c.json({ error: "Invalid story name" }, 400);

  const existing = ptySessions.get(storyName);
  if (existing?.term && existing.state === "running") {
    return c.json({ ok: true, pid: existing.term.pid, storyName, sessionId: existing.sessionId, reused: true });
  }

  // Enforce max concurrent sessions
  const running = [...ptySessions.values()].filter((s) => s.state === "running").length;
  if (running >= MAX_SESSIONS) {
    return c.json({ error: `Max ${MAX_SESSIONS} concurrent sessions`, ok: false }, 429);
  }

  try {
    const session = spawnPty(storyName, { resume: body.resume });
    return c.json({ ok: true, pid: session.term.pid, storyName, sessionId: session.sessionId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to spawn PTY";
    return c.json({ ok: false, error: message }, 500);
  }
});

/** GET /api/terminal/session/:storyName — get stored session ID for a story */
terminal.get("/session/:storyName", (c) => {
  const storyName = safeName(c.req.param("storyName"));
  if (!storyName) return c.json({ error: "Invalid story name" }, 400);

  const sessionMap = loadSessionMap();
  const sessionId = sessionMap[storyName] || null;
  const active = ptySessions.get(storyName);

  return c.json({
    sessionId,
    running: !!active && active.state === "running",
  });
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
  const sessions: Record<string, { running: boolean; pid: number | null; sessionId: string }> = {};
  for (const [name, session] of ptySessions) {
    sessions[name] = {
      running: session.state === "running",
      pid: session.term?.pid ?? null,
      sessionId: session.sessionId,
    };
  }
  return c.json({ sessions });
});

/**
 * Attach a raw WebSocket to a story's PTY session.
 * Called from server.ts WebSocket upgrade handler.
 */
export function attachTerminalWs(ws: WebSocket, storyName?: string, resume?: boolean) {
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
      session = spawnPty(name, { resume });
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
