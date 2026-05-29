import { describe, it, expect } from "vitest";
import { buildClaudeCommand, isTerminalSocketOpen, resolveBypass } from "./terminal";

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

describe("isTerminalSocketOpen", () => {
  it("uses the numeric readyState value instead of browser WebSocket.OPEN", () => {
    expect(isTerminalSocketOpen({ readyState: 1 })).toBe(true);
    expect(isTerminalSocketOpen({ readyState: 0 })).toBe(false);
    expect(isTerminalSocketOpen({ readyState: 2 })).toBe(false);
    expect(isTerminalSocketOpen({ readyState: 3 })).toBe(false);
  });
});
