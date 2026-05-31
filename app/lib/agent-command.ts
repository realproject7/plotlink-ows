import type { AgentProvider } from "../routes/stories";

/**
 * Pure construction of a terminal agent's CLI invocation as argv.
 *
 * This module performs NO fs/pty/env/network access so command building is
 * fully unit-testable. It returns `{ command, args }` (the binary + argv).
 *
 * Claude (KEEP BYTE-IDENTICAL with the legacy inline behavior):
 *   - fresh:  `claude --session-id <newSessionId>`
 *   - resume: `claude --resume <sessionId>`
 *   - bypass: append `--dangerously-skip-permissions`
 *
 * Codex (net-new):
 *   - fresh:  `codex --enable image_generation --cd <storyDir>`
 *   - resume: `codex resume <sessionId>` (subcommand style) when an id is
 *             stored, otherwise `codex resume --last`. NEVER `--resume <id>`.
 *   - bypass: append `--dangerously-bypass-approvals-and-sandbox`
 *
 * Claude-only and Codex-only flags are never mixed across providers.
 */
export type AgentMode = "normal" | "bypass";

export interface BuildAgentCommandOptions {
  provider: AgentProvider;
  mode: AgentMode;
  resume: boolean;
  /** Stored resume id (Claude UUID / Codex session id), or null. */
  sessionId: string | null;
  /** Freshly generated UUID used for a brand-new Claude session. */
  newSessionId: string;
  /** Absolute story working directory (used by Codex `--cd`). */
  storyDir: string;
}

export interface AgentCommand {
  command: string;
  args: string[];
}

export function buildAgentCommand(opts: BuildAgentCommandOptions): AgentCommand {
  if (opts.provider === "codex") {
    return buildCodexCommand(opts);
  }
  return buildClaudeArgs(opts);
}

function buildClaudeArgs(opts: BuildAgentCommandOptions): AgentCommand {
  const args: string[] = [];
  // Resume only when requested AND a stored id exists; else fresh session.
  if (opts.resume && opts.sessionId) {
    args.push("--resume", opts.sessionId);
  } else {
    args.push("--session-id", opts.newSessionId);
  }
  if (opts.mode === "bypass") {
    args.push("--dangerously-skip-permissions");
  }
  return { command: "claude", args };
}

function buildCodexCommand(opts: BuildAgentCommandOptions): AgentCommand {
  const args: string[] = [];
  if (opts.resume) {
    // Codex resume is a subcommand, never `--resume <id>`.
    if (opts.sessionId) {
      args.push("resume", opts.sessionId);
    } else {
      args.push("resume", "--last");
    }
  } else {
    // Fresh Codex session: enable image generation + set cwd.
    args.push("--enable", "image_generation", "--cd", opts.storyDir);
  }
  if (opts.mode === "bypass") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }
  return { command: "codex", args };
}
