// Agent (CLI) readiness detection.
//
// This module is pure: every shell interaction goes through an injected `run`
// function so it can be unit-tested without spawning processes. The route layer
// supplies a real `run` that shells out via the user's login shell, and stamps
// the `checkedAt` timestamp (kept OUT of this pure function so it stays
// deterministic/testable — no clocks here).
//
// Codex image-generation detection parses the structured `codex features list`
// output rather than guessing from generic `--help` text. See
// `probeAgentReadiness` for the exact parsing rules.

export type ImageGenStatus = "enabled" | "disabled" | "unknown";

export interface AgentReadiness {
  claude: { installed: boolean };
  codex: { installed: boolean; version: string | null; imageGeneration: ImageGenStatus };
  checkedAt: number; // epoch ms — added by the route, NOT by the pure probe.
}

/** First non-empty, trimmed line of a command's stdout (or null). */
function firstNonEmptyTrimmedLine(stdout: string): string | null {
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (line.length > 0) return line;
  }
  return null;
}

/**
 * Determine the effective image_generation state from a single matched line of
 * `codex features list` output.
 *
 * Rules:
 *  - "enabled" when the line shows a truthy state: `true`, `enabled`, `on`, or
 *    a trailing check mark (✓).
 *  - "disabled" when the line shows a falsy state: `false`, `disabled`, `off`.
 *  - "unknown" when image_generation is present but the state is unparseable.
 *
 * Truthy is checked before falsy is irrelevant because a single line never
 * carries both; we test falsy first to avoid `disabled` matching a substring of
 * something truthy (there is none, but order keeps intent explicit).
 */
function parseImageGenLine(line: string): ImageGenStatus {
  const l = line.toLowerCase();
  // Falsy markers.
  if (/\b(false|disabled|off)\b/.test(l)) return "disabled";
  // Truthy markers (word states or a trailing check mark).
  if (/\b(true|enabled|on)\b/.test(l) || /✓/.test(line)) return "enabled";
  return "unknown";
}

/**
 * Probe local agent CLIs. Pure: all shelling-out is injected via `run`.
 * Returns everything except `checkedAt` (the route stamps that with Date.now()).
 *
 * Checks performed:
 *  - claude.installed: `claude --version` succeeds.
 *  - codex.installed:  `codex --version` succeeds.
 *  - codex.version:    first non-empty line of `codex --version` stdout (or null).
 *  - codex.imageGeneration: parsed from `codex features list`:
 *      * codex not installed                 -> "unknown"
 *      * `codex features list` fails / empty  -> "unknown"
 *      * line mentions image_generation:      -> parseImageGenLine(...)
 *      * successful listing WITHOUT the line  -> "disabled"
 *        (a real `features list` that omits image_generation means the feature
 *        isn't available)
 */
export async function probeAgentReadiness(
  run: (cmd: string) => Promise<{ ok: boolean; stdout: string }>,
): Promise<Omit<AgentReadiness, "checkedAt">> {
  const claudeInstalled = (await run("claude --version")).ok;

  const codexVersionResult = await run("codex --version");
  const codexInstalled = codexVersionResult.ok;
  const codexVersion = codexInstalled
    ? firstNonEmptyTrimmedLine(codexVersionResult.stdout) || null
    : null;

  let imageGeneration: ImageGenStatus = "unknown";

  if (codexInstalled) {
    const features = await run("codex features list");
    if (features.ok && features.stdout.trim().length > 0) {
      // Accept either `image_generation` or `image-generation` naming.
      const matchLine = features.stdout
        .split("\n")
        .find((line) => {
          const l = line.toLowerCase();
          return l.includes("image_generation") || l.includes("image-generation");
        });
      if (matchLine) {
        imageGeneration = parseImageGenLine(matchLine);
      } else {
        // Successful listing that never mentions image_generation => not available.
        imageGeneration = "disabled";
      }
    }
    // else: command failed or empty -> stays "unknown".
  }

  return {
    claude: { installed: claudeInstalled },
    codex: { installed: codexInstalled, version: codexVersion, imageGeneration },
  };
}
