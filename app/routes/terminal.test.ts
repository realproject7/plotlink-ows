import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildClaudeCommand,
  isTerminalSocketOpen,
  resolveBypass,
  resolveProvider,
  resolveRenamedStoryMeta,
  resolveAgentCommandForSession,
  shellQuote,
} from "./terminal";

describe("buildClaudeCommand", () => {
  it("normal fresh session: --session-id, no bypass flag", () => {
    const cmd = buildClaudeCommand({ resume: false, sessionId: "abc-123" });
    expect(cmd).toBe('claude --session-id "abc-123"');
    expect(cmd).not.toContain("--dangerously-skip-permissions");
  });

  it("normal resume: --resume, no bypass flag", () => {
    const cmd = buildClaudeCommand({ resume: true, sessionId: "abc-123" });
    expect(cmd).toBe('claude --resume "abc-123"');
    expect(cmd).not.toContain("--dangerously-skip-permissions");
  });

  it("bypass fresh session: adds --dangerously-skip-permissions", () => {
    const cmd = buildClaudeCommand({ resume: false, sessionId: "abc-123", bypass: true });
    expect(cmd).toBe('claude --session-id "abc-123" --dangerously-skip-permissions');
  });

  it("bypass resume: adds --dangerously-skip-permissions", () => {
    const cmd = buildClaudeCommand({ resume: true, sessionId: "abc-123", bypass: true });
    expect(cmd).toBe('claude --resume "abc-123" --dangerously-skip-permissions');
  });

  it("bypass false is identical to normal", () => {
    const normal = buildClaudeCommand({ resume: false, sessionId: "x" });
    const explicitFalse = buildClaudeCommand({ resume: false, sessionId: "x", bypass: false });
    expect(explicitFalse).toBe(normal);
  });
});

describe("resolveBypass", () => {
  it("new story honors explicit bypass=true", () => {
    expect(resolveBypass({ isNewStory: true, optBypass: true })).toBe(true);
  });

  it("new story defaults to normal without explicit flag", () => {
    expect(resolveBypass({ isNewStory: true })).toBe(false);
  });

  it("new story falls back to session mode when no explicit flag", () => {
    expect(resolveBypass({ isNewStory: true, sessionMode: "bypass" })).toBe(true);
  });

  it("existing story IGNORES client bypass flag (security)", () => {
    // Malicious WS sends bypass=true, but stored metadata is normal.
    expect(resolveBypass({ isNewStory: false, optBypass: true, storedMode: "normal" })).toBe(false);
    expect(resolveBypass({ isNewStory: false, optBypass: true })).toBe(false);
  });

  it("existing story derives bypass from stored .story.json mode", () => {
    expect(resolveBypass({ isNewStory: false, storedMode: "bypass" })).toBe(true);
    expect(resolveBypass({ isNewStory: false, storedMode: "normal" })).toBe(false);
  });

  it("existing story prefers in-memory session mode over stored", () => {
    // Already-spawned session mode wins; client flag still ignored.
    expect(resolveBypass({ isNewStory: false, optBypass: false, sessionMode: "bypass", storedMode: "normal" })).toBe(true);
  });
});

describe("resolveProvider", () => {
  it("new story honors explicit optProvider=codex", () => {
    expect(resolveProvider({ isNewStory: true, optProvider: "codex" })).toBe("codex");
  });

  it("new story defaults to claude without explicit flag", () => {
    expect(resolveProvider({ isNewStory: true })).toBe("claude");
  });

  it("new story falls back to session provider when no optProvider", () => {
    expect(resolveProvider({ isNewStory: true, sessionProvider: "codex" })).toBe("codex");
  });

  it("existing story IGNORES client optProvider (security)", () => {
    // Malicious WS sends provider=codex, but stored metadata is claude.
    expect(resolveProvider({ isNewStory: false, optProvider: "codex", storedProvider: "claude" })).toBe("claude");
  });

  it("existing story derives provider from stored .story.json", () => {
    expect(resolveProvider({ isNewStory: false, storedProvider: "codex" })).toBe("codex");
  });

  it("existing story prefers in-memory session provider over stored", () => {
    expect(resolveProvider({ isNewStory: false, optProvider: "claude", sessionProvider: "codex", storedProvider: "claude" })).toBe("codex");
  });

  // End-to-end regression for PR #260: a brand-new cartoon (_new_) session must
  // invoke codex, not claude. Compose the two pure functions exactly as spawnPty
  // does for a fresh _new_ spawn: resolve provider from the client flag, then
  // render the concrete CLI command for that provider.
  it("end-to-end: cartoon _new_ spawn (provider=codex) yields a codex command", () => {
    const provider = resolveProvider({ isNewStory: true, optProvider: "codex" });
    expect(provider).toBe("codex");
    const cmd = resolveAgentCommandForSession({
      provider,
      mode: "normal",
      resumeRequested: false,
      stored: undefined,
      newSessionId: "fresh-uuid",
      storyDir: "/stories/_new_123",
    });
    expect(cmd.command).toBe("codex");
    expect(cmd.command).not.toBe("claude");
  });

  // Byte-identical guarantee: a fiction _new_ spawn with NO provider flag still
  // resolves to claude and renders the unchanged claude fresh-session command.
  it("end-to-end: fiction _new_ spawn (no flag) yields the unchanged claude command", () => {
    const provider = resolveProvider({ isNewStory: true });
    expect(provider).toBe("claude");
    const cmd = resolveAgentCommandForSession({
      provider,
      mode: "normal",
      resumeRequested: false,
      stored: undefined,
      newSessionId: "fresh-uuid",
      storyDir: "/stories/_new_123",
    });
    expect(cmd).toEqual({ command: "claude", args: ["--session-id", "fresh-uuid"] });
  });
});

describe("resolveRenamedStoryMeta (#295 — persist provider on _new_* confirm)", () => {
  const fictionExisting = { contentType: "fiction" as const };

  it("persists cartoon + codex for a fresh cartoon story (body carries both)", () => {
    const meta = resolveRenamedStoryMeta({
      existing: fictionExisting,
      bodyContentType: "cartoon",
      bodyLanguage: "English",
      bodyAgentMode: "normal",
      bodyProvider: "codex",
    });
    expect(meta).toEqual({ contentType: "cartoon", language: "English", agentMode: "normal", agentProvider: "codex" });
  });

  it("falls back to the carried session provider when the body omits agentProvider", () => {
    const meta = resolveRenamedStoryMeta({
      existing: fictionExisting,
      bodyContentType: "cartoon",
      sessionProvider: "codex",
    });
    expect(meta?.agentProvider).toBe("codex");
    expect(meta?.contentType).toBe("cartoon");
  });

  it("returns null when there is nothing to record (no provider, no explicit contentType)", () => {
    expect(resolveRenamedStoryMeta({ existing: fictionExisting })).toBeNull();
  });

  it("merges over existing metadata without dropping fields the body omits", () => {
    const meta = resolveRenamedStoryMeta({
      existing: { contentType: "cartoon", language: "Korean", agentMode: "bypass", agentProvider: "codex" },
      bodyProvider: "codex",
    });
    // No explicit contentType in body → keep existing cartoon; language/mode preserved.
    expect(meta).toEqual({ contentType: "cartoon", language: "Korean", agentMode: "bypass", agentProvider: "codex" });
  });

  it("does not invent a provider for a fiction story (records contentType only)", () => {
    const meta = resolveRenamedStoryMeta({ existing: fictionExisting, bodyContentType: "fiction" });
    expect(meta).toEqual({ contentType: "fiction" });
    expect(meta?.agentProvider).toBeUndefined();
  });
});

describe("shellQuote (command-injection safety)", () => {
  it("wraps plain values in single quotes", () => {
    expect(shellQuote("abc-123")).toBe("'abc-123'");
  });

  it("neutralizes double quotes so they cannot break out", () => {
    // Naive `"${a}"` wrapping would let a `"` close the quote and inject.
    const quoted = shellQuote('a"; rm -rf /; echo "');
    // Whole value stays inside the outer single quotes; no unescaped `"` ends a token.
    expect(quoted.startsWith("'")).toBe(true);
    expect(quoted.endsWith("'")).toBe(true);
    expect(quoted).toBe(`'a"; rm -rf /; echo "'`);
  });

  it("neutralizes $ and backtick (no expansion / command substitution)", () => {
    expect(shellQuote("$(touch pwned)")).toBe("'$(touch pwned)'");
    expect(shellQuote("`touch pwned`")).toBe("'`touch pwned`'");
    expect(shellQuote("$HOME")).toBe("'$HOME'");
  });

  it("escapes embedded single quotes with the '\\'' trick", () => {
    // A value containing a single quote must close, escape, and reopen the quote.
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
    // The escape itself cannot be used to break out: the only unquoted char is
    // the backslash-escaped quote, which the shell reads as a literal '.
    const evil = "'; rm -rf / #";
    expect(shellQuote(evil)).toBe("''\\''; rm -rf / #'");
  });

  it("assembles a command + args into the expected quoted string", () => {
    const command = "codex";
    const args = ["resume", "id-with-\"-and-$-and-`", "--cwd", "/path/it's here"];
    const assembled = [command, ...args].map(shellQuote).join(" ");
    expect(assembled).toBe(
      "'codex' 'resume' 'id-with-\"-and-$-and-`' '--cwd' '/path/it'\\''s here'"
    );
  });

  it("round-trips through a real shell with NO injection (definitive proof)", () => {
    // The strongest possible assertion: feed the assembled quoted args to a real
    // POSIX shell via `printf '%s\n'` and confirm the shell parses back EXACTLY
    // the original argv — no extra tokens, no command substitution, no breakout.
    // A side-effect canary file would exist if substitution ran; assert it never does.
    const canary = path.join(os.tmpdir(), `shellquote-canary-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const malicious = [
      `x"; touch ${canary}; echo "`, // double-quote breakout attempt
      `$(touch ${canary})`, // command substitution attempt
      `\`touch ${canary}\``, // backtick substitution attempt
      "it's a 'quoted' value", // embedded single quotes
      "$HOME and \\ and spaces", // var expansion + backslash + spaces
    ];
    const quoted = malicious.map(shellQuote).join(" ");
    // Print each parsed token on its own line so we can compare to the input argv.
    const out = execFileSync("/bin/sh", ["-c", `printf '%s\\n' ${quoted}`], { encoding: "utf-8" });
    const parsed = out.split("\n").slice(0, -1); // drop trailing empty
    expect(parsed).toEqual(malicious);
    // No substitution executed → canary must NOT exist.
    expect(fs.existsSync(canary)).toBe(false);
  });
});

describe("resolveAgentCommandForSession (resume decision)", () => {
  const base = {
    mode: "normal" as const,
    newSessionId: "fresh-uuid",
    storyDir: "/stories/my-tale",
  };

  // Regression for PR #259: a Codex record with sessionId:null + resume:true
  // must reach native `codex resume --last`, NOT a fresh `--enable
  // image_generation --cd` launch. The previous spawnPty logic gated resume on
  // a stored id (correct for Claude, wrong for Codex), so this case fell back
  // to a fresh session.
  // #265: resume now also preserves the story cwd (--cd) and image_generation.
  it("codex resume with stored {sessionId:null} => codex resume --last + cwd/image-gen", () => {
    const result = resolveAgentCommandForSession({
      ...base,
      provider: "codex",
      resumeRequested: true,
      stored: { provider: "codex", sessionId: null },
    });
    expect(result).toEqual({
      command: "codex",
      args: ["resume", "--last", "--enable", "image_generation", "--cd", "/stories/my-tale"],
    });
  });

  it("codex resume with stored {sessionId:'CDX'} => codex resume CDX + cwd/image-gen", () => {
    const result = resolveAgentCommandForSession({
      ...base,
      provider: "codex",
      resumeRequested: true,
      stored: { provider: "codex", sessionId: "CDX" },
    });
    expect(result).toEqual({
      command: "codex",
      args: ["resume", "CDX", "--enable", "image_generation", "--cd", "/stories/my-tale"],
    });
  });

  it("codex resume requested with no stored record => codex resume --last + cwd/image-gen", () => {
    const result = resolveAgentCommandForSession({
      ...base,
      provider: "codex",
      resumeRequested: true,
      stored: undefined,
    });
    expect(result).toEqual({
      command: "codex",
      args: ["resume", "--last", "--enable", "image_generation", "--cd", "/stories/my-tale"],
    });
  });

  it("codex without resume => fresh --enable image_generation --cd", () => {
    const result = resolveAgentCommandForSession({
      ...base,
      provider: "codex",
      resumeRequested: false,
      stored: { provider: "codex", sessionId: null },
    });
    expect(result).toEqual({
      command: "codex",
      args: ["--enable", "image_generation", "--cd", "/stories/my-tale"],
    });
  });

  it("claude resume with stored id => --resume <id> (unchanged)", () => {
    const result = resolveAgentCommandForSession({
      ...base,
      provider: "claude",
      resumeRequested: true,
      stored: "CLAUDE-ID",
    });
    expect(result).toEqual({
      command: "claude",
      args: ["--resume", "CLAUDE-ID"],
    });
  });

  it("claude resume with no stored id => fresh --session-id <new> (unchanged)", () => {
    const result = resolveAgentCommandForSession({
      ...base,
      provider: "claude",
      resumeRequested: true,
      stored: undefined,
    });
    expect(result).toEqual({
      command: "claude",
      args: ["--session-id", "fresh-uuid"],
    });
  });
});

describe("isTerminalSocketOpen", () => {
  it("uses the numeric readyState value instead of browser WebSocket.OPEN", () => {
    expect(isTerminalSocketOpen({ readyState: 1 })).toBe(true);
    expect(isTerminalSocketOpen({ readyState: 0 })).toBe(false);
    expect(isTerminalSocketOpen({ readyState: 2 })).toBe(false);
    expect(isTerminalSocketOpen({ readyState: 3 })).toBe(false);
  });
});
