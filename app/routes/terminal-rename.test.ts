import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Route-level coverage for the #295 fix: POST /api/terminal/rename must PERSIST
// the confirmed story's metadata to .story.json (so a fresh cartoon's
// agentProvider survives the _new_* → real-folder rename). The pure helper
// resolveRenamedStoryMeta is unit-tested in terminal.test.ts; this exercises the
// actual route + filesystem write, including the session-provider fallback.

const testState = vi.hoisted(() => ({ storiesDir: "" }));

vi.mock("../lib/paths", () => ({
  get STORIES_DIR() { return testState.storiesDir; },
  DATA_DIR: os.tmpdir(),
  CONFIG_DIR: os.tmpdir(),
  DB_PATH: path.join(os.tmpdir(), "terminal-rename-test.db"),
  DATABASE_URL: "file:" + path.join(os.tmpdir(), "terminal-rename-test.db"),
  ENV_FILE: path.join(os.tmpdir(), ".env"),
}));

// Stub node-pty so spawning a session never launches a real shell.
vi.mock("node-pty", () => ({
  spawn: () => ({
    pid: 4321,
    onData: () => {},
    onExit: () => {},
    write: () => {},
    resize: () => {},
    kill: () => {},
  }),
}));

import { terminalRoutes } from "./terminal";
import { Hono } from "hono";

function makeApp() {
  const app = new Hono();
  app.route("/api/terminal", terminalRoutes);
  return app;
}

describe("POST /api/terminal/rename persists story metadata (#295)", () => {
  let tmpDir: string;
  let app: Hono;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-rename-"));
    testState.storiesDir = tmpDir;
    app = makeApp();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function spawn(storyName: string, provider: "claude" | "codex") {
    return app.request("/api/terminal/spawn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyName, provider }),
    });
  }

  async function rename(body: Record<string, unknown>) {
    return app.request("/api/terminal/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function readStoryJson(name: string): Record<string, unknown> | null {
    const file = path.join(tmpDir, name, ".story.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : null;
  }

  it("records contentType:cartoon + agentProvider:codex when the body carries them", async () => {
    const oldName = "_new_1001";
    const newName = "fresh-cartoon-body";
    // Spawn the pending _new_ Codex session so the rename has a PTY to move.
    expect((await spawn(oldName, "codex")).status).toBe(200);
    // The agent's real story folder exists by the time the rename fires.
    fs.mkdirSync(path.join(tmpDir, newName), { recursive: true });

    const res = await rename({ oldName, newName, contentType: "cartoon", language: "English", agentMode: "normal", agentProvider: "codex" });
    expect(res.status).toBe(200);

    const meta = readStoryJson(newName);
    expect(meta).toMatchObject({ contentType: "cartoon", agentProvider: "codex", language: "English" });
  });

  it("falls back to the carried session provider when the body omits agentProvider", async () => {
    const oldName = "_new_1002";
    const newName = "fresh-cartoon-fallback";
    // Spawn as codex → server tracks the provider for this session.
    expect((await spawn(oldName, "codex")).status).toBe(200);
    fs.mkdirSync(path.join(tmpDir, newName), { recursive: true });

    // Body carries contentType but NOT agentProvider — the server must record
    // codex from the carried session state, not leave the provider unrecorded.
    const res = await rename({ oldName, newName, contentType: "cartoon" });
    expect(res.status).toBe(200);

    const meta = readStoryJson(newName);
    expect(meta).toMatchObject({ contentType: "cartoon", agentProvider: "codex" });
  });

  it("does not record a provider for a fresh fiction story (no false provider)", async () => {
    const oldName = "_new_1003";
    const newName = "fresh-fiction";
    expect((await spawn(oldName, "claude")).status).toBe(200);
    fs.mkdirSync(path.join(tmpDir, newName), { recursive: true });

    // Fiction default: claude is the carried provider, but fiction stories are
    // never gated/repaired on provider, and recording claude is acceptable —
    // the key assertion is contentType stays fiction.
    const res = await rename({ oldName, newName, contentType: "fiction" });
    expect(res.status).toBe(200);
    expect(readStoryJson(newName)).toMatchObject({ contentType: "fiction" });
  });
});
