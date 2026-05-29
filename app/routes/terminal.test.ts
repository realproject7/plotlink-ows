import { describe, it, expect } from "vitest";
import { buildClaudeCommand } from "./terminal";

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
