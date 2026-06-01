import { describe, it, expect } from "vitest";
import { buildAgentCommand } from "./agent-command";

const STORY_DIR = "/home/user/.plotlink-ows/stories/my-story";
const NEW_ID = "11111111-1111-4111-8111-111111111111";
const STORED_ID = "22222222-2222-4222-8222-222222222222";

describe("buildAgentCommand — Claude (byte-identical semantics)", () => {
  it("fresh: claude --session-id <newSessionId>", () => {
    expect(
      buildAgentCommand({ provider: "claude", mode: "normal", resume: false, sessionId: null, newSessionId: NEW_ID, storyDir: STORY_DIR }),
    ).toEqual({ command: "claude", args: ["--session-id", NEW_ID] });
  });

  it("resume: claude --resume <storedSessionId>", () => {
    expect(
      buildAgentCommand({ provider: "claude", mode: "normal", resume: true, sessionId: STORED_ID, newSessionId: NEW_ID, storyDir: STORY_DIR }),
    ).toEqual({ command: "claude", args: ["--resume", STORED_ID] });
  });

  it("resume requested but no stored id ⇒ fresh", () => {
    expect(
      buildAgentCommand({ provider: "claude", mode: "normal", resume: true, sessionId: null, newSessionId: NEW_ID, storyDir: STORY_DIR }).args,
    ).toEqual(["--session-id", NEW_ID]);
  });

  it("bypass appends --dangerously-skip-permissions", () => {
    expect(
      buildAgentCommand({ provider: "claude", mode: "bypass", resume: false, sessionId: null, newSessionId: NEW_ID, storyDir: STORY_DIR }).args,
    ).toEqual(["--session-id", NEW_ID, "--dangerously-skip-permissions"]);
  });

  it("never emits Codex-only flags", () => {
    const { args } = buildAgentCommand({ provider: "claude", mode: "bypass", resume: false, sessionId: null, newSessionId: NEW_ID, storyDir: STORY_DIR });
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("--enable");
    expect(args).not.toContain("resume");
  });
});

describe("buildAgentCommand — Codex", () => {
  it("fresh: codex --enable image_generation --cd <storyDir>", () => {
    expect(
      buildAgentCommand({ provider: "codex", mode: "normal", resume: false, sessionId: null, newSessionId: NEW_ID, storyDir: STORY_DIR }),
    ).toEqual({ command: "codex", args: ["--enable", "image_generation", "--cd", STORY_DIR] });
  });

  it("resume with id preserves cwd + image generation: codex resume <id> --enable image_generation --cd <storyDir>", () => {
    const { command, args } = buildAgentCommand({ provider: "codex", mode: "normal", resume: true, sessionId: STORED_ID, newSessionId: NEW_ID, storyDir: STORY_DIR });
    expect(command).toBe("codex");
    expect(args).toEqual(["resume", STORED_ID, "--enable", "image_generation", "--cd", STORY_DIR]);
    expect(args).not.toContain("--resume");
  });

  it("resume without id preserves cwd + image generation: codex resume --last --enable image_generation --cd <storyDir>", () => {
    expect(
      buildAgentCommand({ provider: "codex", mode: "normal", resume: true, sessionId: null, newSessionId: NEW_ID, storyDir: STORY_DIR }).args,
    ).toEqual(["resume", "--last", "--enable", "image_generation", "--cd", STORY_DIR]);
  });

  it("resume always carries the story cwd and image_generation capability", () => {
    for (const sessionId of [STORED_ID, null]) {
      const { args } = buildAgentCommand({ provider: "codex", mode: "normal", resume: true, sessionId, newSessionId: NEW_ID, storyDir: STORY_DIR });
      expect(args).toContain("--enable");
      expect(args).toContain("image_generation");
      expect(args.slice(-2)).toEqual(["--cd", STORY_DIR]);
    }
  });

  it("bypass fresh appends --dangerously-bypass-approvals-and-sandbox", () => {
    expect(
      buildAgentCommand({ provider: "codex", mode: "bypass", resume: false, sessionId: null, newSessionId: NEW_ID, storyDir: STORY_DIR }).args,
    ).toEqual(["--enable", "image_generation", "--cd", STORY_DIR, "--dangerously-bypass-approvals-and-sandbox"]);
  });

  it("bypass resume appends --dangerously-bypass-approvals-and-sandbox after cwd", () => {
    expect(
      buildAgentCommand({ provider: "codex", mode: "bypass", resume: true, sessionId: STORED_ID, newSessionId: NEW_ID, storyDir: STORY_DIR }).args,
    ).toEqual(["resume", STORED_ID, "--enable", "image_generation", "--cd", STORY_DIR, "--dangerously-bypass-approvals-and-sandbox"]);
  });

  it("never emits Claude-only flags", () => {
    const { args } = buildAgentCommand({ provider: "codex", mode: "bypass", resume: false, sessionId: null, newSessionId: NEW_ID, storyDir: STORY_DIR });
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--resume");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });
});
