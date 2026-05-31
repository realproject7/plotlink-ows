import { describe, it, expect } from "vitest";
import { probeAgentReadiness } from "./agent-readiness";

type RunResult = { ok: boolean; stdout: string };

// Builds a fake `run` keyed by the exact command string. Commands not present
// default to a failing result with empty stdout.
function fakeRun(map: Record<string, RunResult>) {
  return async (cmd: string): Promise<RunResult> =>
    map[cmd] ?? { ok: false, stdout: "" };
}

describe("probeAgentReadiness", () => {
  it("claude + codex installed, image generation enabled", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex --help": {
        ok: true,
        stdout: "Usage: codex\nFeatures: image_generation, web_search",
      },
    });
    const result = await probeAgentReadiness(run);
    expect(result).toEqual({
      claude: { installed: true },
      codex: { installed: true, imageGeneration: "enabled" },
    });
  });

  it("codex not installed -> installed:false, imageGeneration:unknown", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      // codex --version absent -> fails
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex).toEqual({
      installed: false,
      imageGeneration: "unknown",
    });
  });

  it("codex installed but probe command fails -> imageGeneration:unknown", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex --help": { ok: false, stdout: "" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("unknown");
  });

  it("codex installed but probe output empty -> imageGeneration:unknown", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex --help": { ok: true, stdout: "   \n " },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("unknown");
  });

  it("claude not installed sets claude.installed:false (fiction is a UI concern)", async () => {
    const run = fakeRun({
      // claude --version absent -> fails
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex --help": { ok: true, stdout: "Features: image_generation" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.claude.installed).toBe(false);
  });

  it("codex help lists capabilities without image generation -> disabled", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex --help": { ok: true, stdout: "Usage: codex\nFeatures: web_search" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("disabled");
  });

  it("codex help explicitly marks image generation disabled -> disabled", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex --help": {
        ok: true,
        stdout: "Features:\n  image_generation: disabled\n  web_search: enabled",
      },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("disabled");
  });
});
