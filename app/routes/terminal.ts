import { Hono } from "hono";
import * as pty from "node-pty";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { STORIES_DIR, DATA_DIR } from "../lib/paths";
import { readStoryMeta } from "./stories";
import type { AgentProvider } from "./stories";
import { writeStoryInstructions } from "../lib/generate-story-instructions";
import { buildAgentCommand } from "../lib/agent-command";
import type { AgentMode, AgentCommand } from "../lib/agent-command";

/**
 * Provider-aware session record (new shape). Written ONLY for Codex sessions.
 * Claude sessions keep being persisted as a bare string (legacy shape) so a
 * rollback to an older app version still resumes fiction/Claude stories.
 */
export interface SessionRecord {
  provider: AgentProvider;
  sessionId: string | null;
  lastStartedAt?: number;
}
export type StoredValue = string | SessionRecord;

export function isSessionRecord(v: StoredValue | undefined): v is SessionRecord {
  return typeof v === "object" && v !== null && "provider" in v;
}

/** Resolve a resume id from either stored shape (string → itself, record → .sessionId). */
export function resumeIdFrom(v: StoredValue | undefined): string | null {
  if (typeof v === "string") return v;
  if (isSessionRecord(v)) return typeof v.sessionId === "string" ? v.sessionId : null;
  return null;
}

/**
 * Resolve the concrete agent CLI invocation (argv) for a Codex spawn, given the
 * stored session value and whether the user requested a resume.
 *
 * Codex decouples "resume requested" from "stored id exists" — unlike Claude:
 * - Claude needs a CONCRETE session id to resume (`--resume <id>`); with no
 *   stored id it must start fresh (`--session-id <new>`). So Claude resume only
 *   happens when both resumeRequested AND a stored id exist.
 * - Codex can resume the most recent session with no id at all
 *   (`codex resume --last`). So a resume request alone is enough; a stored id
 *   (when present) just picks a specific session (`codex resume <id>`).
 *
 * This is the single code path shared by spawnPty (codex branch) and the
 * route/session regression tests, so they exercise identical logic.
 */
export function resolveAgentCommandForSession(opts: {
  provider: AgentProvider;
  mode: AgentMode;
  resumeRequested: boolean;
  stored: StoredValue | undefined;
  newSessionId: string;
  storyDir: string;
}): AgentCommand {
  const { provider, mode, resumeRequested, stored, newSessionId, storyDir } = opts;
  const storedResumeId = resumeIdFrom(stored);

  if (provider === "claude") {
    // Claude requires a concrete id to resume; otherwise fall back to fresh.
    const doResume = !!(resumeRequested && storedResumeId);
    return buildAgentCommand({
      provider,
      mode,
      resume: doResume,
      sessionId: doResume ? storedResumeId : null,
      newSessionId,
      storyDir,
    });
  }

  // Codex: a resume request alone is enough even with no stored id (resume --last).
  return buildAgentCommand({
    provider,
    mode,
    resume: resumeRequested,
    sessionId: storedResumeId,
    newSessionId,
    storyDir,
  });
}

const MAX_SESSIONS = 5;
const SESSION_FILE = path.join(DATA_DIR, "terminal-sessions.json");
const WS_OPEN = 1;

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

/**
 * Load stored sessions from disk. Values may be legacy bare strings (Claude
 * UUIDs) OR new provider-aware records. The file is NEVER migrated wholesale —
 * only the touched key changes shape when actively updated.
 */
function loadSessionMap(): Record<string, StoredValue> {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

/** Save sessions to disk (mixed legacy-string / record values). */
function saveSessionMap(map: Record<string, StoredValue>) {
  try {
    const dir = path.dirname(SESSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(map, null, 2) + "\n");
  } catch { /* ignore */ }
}

/**
 * Build the Claude CLI command string for a session.
 * - resume: reuse an existing session ID
 * - bypass: add --dangerously-skip-permissions (opt-in, less safe)
 */
export function buildClaudeCommand(opts: {
  resume: boolean;
  sessionId: string;
  bypass?: boolean;
}): string {
  let cmd = "claude";
  if (opts.resume) {
    cmd += ` --resume "${opts.sessionId}"`;
  } else {
    cmd += ` --session-id "${opts.sessionId}"`;
  }
  if (opts.bypass) {
    cmd += " --dangerously-skip-permissions";
  }
  return cmd;
}

export function isTerminalSocketOpen(ws: Pick<WebSocket, "readyState">): boolean {
  return ws.readyState === WS_OPEN;
}

/**
 * POSIX single-quote escape for embedding an arbitrary value in a shell string.
 *
 * We invoke the agent via a login shell (`pty.spawn(shell, ["-l","-c", cmd])`)
 * so the user's PATH resolves the `claude`/`codex` binary. That means the argv
 * is assembled into a single shell-parsed string, so every token must be quoted
 * safely. Single-quoting (with the `'\''` trick for embedded quotes) is the only
 * shell quoting that disables ALL special characters ($, `, ", \, spaces), so a
 * value containing `"`, `$`, or a backtick cannot break out of its token.
 */
export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// In-memory agent mode per active session name (covers _new_ sessions and
// reconnects before a story directory / .story.json exists).
const agentModeBySession = new Map<string, "normal" | "bypass">();

// In-memory agent provider per active session name (covers _new_ sessions and
// reconnects before a story directory / .story.json exists). Mirrors
// agentModeBySession exactly.
const agentProviderBySession = new Map<string, "claude" | "codex">();

/**
 * Resolve effective permissions-bypass for a spawn.
 *
 * The client-supplied bypass flag is only trusted for a brand-new (_new_)
 * story's first spawn. For existing stories, bypass derives strictly from
 * server-side state (already-spawned session mode, then stored .story.json),
 * so a direct WS URL cannot force bypass on a story whose metadata says normal.
 */
export function resolveBypass(args: {
  isNewStory: boolean;
  optBypass?: boolean;
  sessionMode?: "normal" | "bypass";
  storedMode?: "normal" | "bypass";
}): boolean {
  if (args.isNewStory) {
    return args.optBypass ?? args.sessionMode === "bypass";
  }
  if (args.sessionMode !== undefined) {
    return args.sessionMode === "bypass";
  }
  return args.storedMode === "bypass";
}

/**
 * Resolve the effective agent provider for a spawn.
 *
 * Mirrors resolveBypass's trust model: the client-supplied provider flag is only
 * trusted for a brand-new (_new_) story's first spawn. For existing stories the
 * provider derives strictly from server-side state (already-spawned session
 * provider, then stored .story.json), so a direct WS URL cannot force a provider
 * on a story whose metadata says otherwise.
 */
export function resolveProvider(args: {
  isNewStory: boolean;
  optProvider?: "claude" | "codex";
  sessionProvider?: "claude" | "codex";
  storedProvider?: "claude" | "codex";
}): "claude" | "codex" {
  if (args.isNewStory) return args.optProvider ?? args.sessionProvider ?? "claude";
  if (args.sessionProvider !== undefined) return args.sessionProvider;
  return args.storedProvider ?? "claude";
}

function spawnPty(storyName: string, opts?: { sessionId?: string; resume?: boolean; bypass?: boolean; provider?: "claude" | "codex" }) {
  // New story sessions spawn in the stories root so Claude can create any folder
  const isNewStory = storyName.startsWith("_new_");
  const storyDir = isNewStory ? STORIES_DIR : path.join(STORIES_DIR, storyName);
  if (!fs.existsSync(storyDir)) fs.mkdirSync(storyDir, { recursive: true });
  if (!isNewStory) {
    const { contentType } = readStoryMeta(storyDir);
    writeStoryInstructions(storyDir, contentType);
  }
  const shell = process.env.SHELL || "/bin/zsh";

  // Resolve effective agent mode (see resolveBypass for the trust model).
  const bypass = resolveBypass({
    isNewStory,
    optBypass: opts?.bypass,
    sessionMode: agentModeBySession.get(storyName),
    storedMode: isNewStory ? undefined : readStoryMeta(storyDir).agentMode,
  });
  agentModeBySession.set(storyName, bypass ? "bypass" : "normal");

  // Resolve effective provider (see resolveProvider for the trust model). For a
  // brand-new _new_ session the client flag is trusted; existing stories ignore
  // it and read from session state then stored .story.json (no migration).
  const provider: AgentProvider = resolveProvider({
    isNewStory,
    optProvider: opts?.provider,
    sessionProvider: agentProviderBySession.get(storyName),
    storedProvider: isNewStory ? undefined : readStoryMeta(storyDir).agentProvider,
  });
  agentProviderBySession.set(storyName, provider);

  // Determine resume id (accepts both legacy-string and record shapes).
  const sessionMap = loadSessionMap();
  const stored = sessionMap[storyName];
  const storedResumeId = resumeIdFrom(stored);
  // Claude needs a concrete stored id to resume; with none it starts fresh.
  const doResume = !!(opts?.resume && storedResumeId);
  // Fresh Claude reuses any explicit opts.sessionId (back-compat) else a new UUID.
  const sessionId = doResume ? (storedResumeId as string) : (opts?.sessionId || randomUUID());

  let agentCmd: string;
  if (provider === "claude") {
    // KEEP BYTE-IDENTICAL: same buildClaudeCommand output as before.
    agentCmd = buildClaudeCommand({ resume: doResume, sessionId, bypass });
  } else {
    // Codex decouples "resume requested" from "stored id exists": a resume
    // request alone yields `codex resume --last` (no stored id needed), while a
    // stored id picks a specific session (`codex resume <id>`). Render argv via
    // the shared resolver, then quote it into an injection-safe shell string.
    const { command, args } = resolveAgentCommandForSession({
      provider,
      mode: bypass ? "bypass" : "normal",
      resumeRequested: !!opts?.resume,
      stored,
      newSessionId: sessionId,
      storyDir,
    });
    agentCmd = [command, ...args].map(shellQuote).join(" ");
  }

  // No --cwd flag for Claude — it uses process cwd, set via pty.spawn({ cwd }).
  const term = pty.spawn(shell, ["-l", "-c", agentCmd], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: storyDir,
    env: process.env as Record<string, string>,
  });

  // Persist session info. Claude keeps the legacy bare-string shape (rollback
  // safe); Codex writes a provider-aware record (its own id resolves later).
  if (provider === "claude") {
    sessionMap[storyName] = sessionId;
  } else {
    sessionMap[storyName] = {
      provider,
      sessionId: doResume ? sessionId : null,
      lastStartedAt: Date.now(),
    };
  }
  saveSessionMap(sessionMap);

  const isResume = !!opts?.resume;
  const spawnTime = Date.now();
  const session = { term, ws: null as WebSocket | null, state: "running" as const, sessionId };
  ptySessions.set(storyName, session);

  term.onExit(({ exitCode }) => {
    // Find this session by term reference — key may have changed via rename
    let currentName: string | undefined;
    let s: typeof session | undefined;
    for (const [key, entry] of ptySessions) {
      if (entry.term === term) { currentName = key; s = entry; break; }
    }
    if (!currentName || !s) return;

    // If a resumed session exits quickly (< 5s), signal client to auto-reconnect fresh
    const elapsed = Date.now() - spawnTime;
    if (isResume && elapsed < 5000 && exitCode !== 0) {
      console.log(`Resume for "${currentName}" failed (exit ${exitCode} in ${elapsed}ms), signaling fresh fallback`);
      ptySessions.delete(currentName);
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
  const body = await c.req.json<{ storyName?: string; resume?: boolean; provider?: "claude" | "codex" }>().catch(() => ({}));
  const storyName = safeName(body.storyName || "default");
  if (!storyName) return c.json({ error: "Invalid story name" }, 400);
  const optProvider = body.provider === "claude" || body.provider === "codex" ? body.provider : undefined;

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
    const session = spawnPty(storyName, { resume: body.resume, provider: optProvider });
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
  const sessionId = resumeIdFrom(sessionMap[storyName]);
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

/** DELETE /api/terminal/:storyName/discard — discard session, kill PTY, clean up metadata */
terminal.delete("/:storyName/discard", (c) => {
  const storyName = safeName(c.req.param("storyName"));
  if (!storyName) return c.json({ error: "Invalid story name" }, 400);

  const session = ptySessions.get(storyName);
  if (session?.term && session.state === "running") {
    // Send exit gracefully, then kill
    try { session.term.write("exit\n"); } catch { /* ignore */ }
    setTimeout(() => {
      try { session.term.kill(); } catch { /* ignore */ }
    }, 500);
    session.state = "stopped";
  }
  ptySessions.delete(storyName);

  // Remove session metadata from terminal-sessions.json
  const sessionMap = loadSessionMap();
  if (sessionMap[storyName]) {
    delete sessionMap[storyName];
    saveSessionMap(sessionMap);
  }

  return c.json({ ok: true });
});

/** POST /api/terminal/rename — rename a session key without killing the process */
terminal.post("/rename", async (c) => {
  const body = await c.req.json<{ oldName?: string; newName?: string }>().catch(() => ({}));
  const oldName = body.oldName && safeName(body.oldName);
  const newName = body.newName && safeName(body.newName);
  if (!oldName || !newName) return c.json({ error: "Invalid names" }, 400);
  if (oldName === newName) return c.json({ ok: true });

  const session = ptySessions.get(oldName);
  if (!session) return c.json({ error: "Session not found" }, 404);

  if (ptySessions.has(newName)) return c.json({ error: "Target session already exists" }, 409);

  // Move in-memory PTY entry
  ptySessions.delete(oldName);
  ptySessions.set(newName, session);

  // Carry the in-memory agent mode across the rename so reconnects stay consistent
  const oldMode = agentModeBySession.get(oldName);
  if (oldMode) {
    agentModeBySession.set(newName, oldMode);
    agentModeBySession.delete(oldName);
  }

  // Carry the in-memory agent provider across the rename too (mirrors mode).
  const oldProvider = agentProviderBySession.get(oldName);
  if (oldProvider) {
    agentProviderBySession.set(newName, oldProvider);
    agentProviderBySession.delete(oldName);
  }

  // Update persisted session map: remove old key, store under new key
  const sessionMap = loadSessionMap();
  delete sessionMap[oldName];
  sessionMap[newName] = session.sessionId;
  saveSessionMap(sessionMap);

  return c.json({ ok: true, sessionId: session.sessionId });
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
export function attachTerminalWs(ws: WebSocket, storyName?: string, resume?: boolean, bypass?: boolean, provider?: "claude" | "codex") {
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
      session = spawnPty(name, { resume, bypass, provider });
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
    if (isTerminalSocketOpen(ws)) {
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
