// Agent (CLI) readiness detection.
//
// This module is pure: every shell interaction goes through an injected `run`
// function so it can be unit-tested without spawning processes. The route layer
// supplies a real `run` that shells out via the user's login shell.
//
// IMPORTANT: image-generation detection is best-effort. We probe Codex's help
// output for a capability hint, but Codex CLIs vary across versions, so we are
// deliberately conservative: we only return "enabled"/"disabled" when the
// capability listing is clearly conclusive, and fall back to "unknown"
// otherwise. "unknown" is a SOFT WARNING in the UI -- it must never hard-block
// cartoon creation, and Claude/fiction is never gated on any of this.

export type ImageGenStatus = "enabled" | "disabled" | "unknown";

export interface AgentReadiness {
  claude: { installed: boolean };
  codex: { installed: boolean; imageGeneration: ImageGenStatus };
}

export async function probeAgentReadiness(
  run: (cmd: string) => Promise<{ ok: boolean; stdout: string }>,
): Promise<AgentReadiness> {
  const claudeInstalled = (await run("claude --version")).ok;
  const codexInstalled = (await run("codex --version")).ok;

  let imageGeneration: ImageGenStatus = "unknown";

  if (codexInstalled) {
    // Best-effort probe: inspect the help/capability listing for an
    // image-generation hint. If the probe command itself fails, or the output
    // is inconclusive/empty, we stay on "unknown" rather than guess.
    const probe = await run("codex --help");
    if (probe.ok && probe.stdout.trim().length > 0) {
      const out = probe.stdout.toLowerCase();
      const mentionsImageGen =
        out.includes("image_generation") || out.includes("image-generation");
      if (mentionsImageGen) {
        // The capability listing clearly references image generation. Treat an
        // explicit "disabled"/"off" qualifier as disabled; otherwise the
        // presence of the feature in a successful listing means enabled.
        const looksDisabled =
          out.includes("image_generation: disabled") ||
          out.includes("image-generation: disabled") ||
          out.includes("image_generation (disabled)") ||
          out.includes("image-generation (disabled)") ||
          out.includes("image_generation: off") ||
          out.includes("image-generation: off");
        imageGeneration = looksDisabled ? "disabled" : "enabled";
      } else {
        // A successful, non-empty capability listing that does not mention
        // image generation at all is treated as a clear absence of the feature.
        imageGeneration = "disabled";
      }
    }
  }

  return {
    claude: { installed: claudeInstalled },
    codex: { installed: codexInstalled, imageGeneration },
  };
}
