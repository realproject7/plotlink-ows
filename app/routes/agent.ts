import { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { probeAgentReadiness } from "../lib/agent-readiness";

const execFileP = promisify(execFile);

const agent = new Hono();

/** GET /api/agent/readiness — probe local agent CLIs (detection only) */
agent.get("/readiness", async (c) => {
  try {
    // Probe through a login shell so PATH matches the terminal's binary
    // resolution (terminal.ts spawns `process.env.SHELL -l -c <cmd>`).
    const shell = process.env.SHELL || "/bin/zsh";
    const run = async (cmd: string) => {
      try {
        const { stdout } = await execFileP(shell, ["-l", "-c", cmd], {
          timeout: 5000,
        });
        return { ok: true, stdout: stdout ?? "" };
      } catch (e: unknown) {
        const stdout =
          e && typeof e === "object" && "stdout" in e
            ? String((e as { stdout: unknown }).stdout ?? "")
            : "";
        return { ok: false, stdout };
      }
    };

    const readiness = await probeAgentReadiness(run);
    return c.json(readiness);
  } catch (error) {
    console.error("Agent readiness error:", error);
    return c.json({ error: "Failed to probe agent readiness" }, 500);
  }
});

export { agent as agentRoutes };
