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
  it("captures codex version and parses image_generation enabled (true)", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex-cli 0.135.0" },
      "codex features list": {
        ok: true,
        stdout: "web_search    enabled\nimage_generation    true\n",
      },
    });
    const result = await probeAgentReadiness(run);
    expect(result).toEqual({
      claude: { installed: true },
      codex: { installed: true, version: "codex-cli 0.135.0", imageGeneration: "enabled" },
    });
    // Pure function must NOT include a clock-stamped field.
    expect("checkedAt" in result).toBe(false);
  });

  it("parses image_generation 'enabled' word state", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex features list": { ok: true, stdout: "image_generation: enabled" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("enabled");
  });

  it("parses image_generation 'on' state", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex features list": { ok: true, stdout: "image_generation  on" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("enabled");
  });

  it("parses image_generation trailing check mark as enabled", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex features list": { ok: true, stdout: "image_generation   ✓" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("enabled");
  });

  it("accepts the image-generation (dash) spelling", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex features list": { ok: true, stdout: "image-generation    true" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("enabled");
  });

  it("parses image_generation false/disabled/off as disabled", async () => {
    for (const state of ["false", "disabled", "off"]) {
      const run = fakeRun({
        "claude --version": { ok: true, stdout: "claude 1.0.0" },
        "codex --version": { ok: true, stdout: "codex 0.5.0" },
        "codex features list": { ok: true, stdout: `image_generation    ${state}` },
      });
      const result = await probeAgentReadiness(run);
      expect(result.codex.imageGeneration).toBe("disabled");
    }
  });

  it("treats a successful listing without image_generation as disabled", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex features list": { ok: true, stdout: "web_search    enabled\napply_patch    enabled" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("disabled");
  });

  it("returns unknown when image_generation state is unparseable", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex features list": { ok: true, stdout: "image_generation   ???" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("unknown");
  });

  it("returns unknown when `codex features list` fails", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex features list": { ok: false, stdout: "" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("unknown");
  });

  it("returns unknown when `codex features list` output is empty", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex features list": { ok: true, stdout: "   \n " },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.imageGeneration).toBe("unknown");
  });

  it("codex not installed -> installed:false, version:null, imageGeneration:unknown", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      // codex --version absent -> fails
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex).toEqual({
      installed: false,
      version: null,
      imageGeneration: "unknown",
    });
  });

  it("claude not installed sets claude.installed:false (fiction is a UI concern)", async () => {
    const run = fakeRun({
      // claude --version absent -> fails
      "codex --version": { ok: true, stdout: "codex 0.5.0" },
      "codex features list": { ok: true, stdout: "image_generation true" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.claude.installed).toBe(false);
  });

  it("captures version from `codex-cli 0.135.0` style output", async () => {
    const run = fakeRun({
      "claude --version": { ok: true, stdout: "claude 1.0.0" },
      "codex --version": { ok: true, stdout: "\ncodex-cli 0.135.0\n" },
      "codex features list": { ok: true, stdout: "image_generation true" },
    });
    const result = await probeAgentReadiness(run);
    expect(result.codex.version).toBe("codex-cli 0.135.0");
  });
});
