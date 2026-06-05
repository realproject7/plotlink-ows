import { describe, it, expect } from "vitest";
import fs from "fs";
import { resolvePrismaCli } from "./prisma-cli";

// #479: startup runs `db push` via the locally-resolved Prisma CLI invoked with
// `node`, never `npx prisma` (which can hit the network / depends on cwd). The
// resolver must return a real, existing CLI path from the package's node_modules.
describe("resolvePrismaCli (#479)", () => {
  it("resolves to an existing local prisma CLI entry", () => {
    // vitest runs from the repo root, which has prisma installed in node_modules.
    const cli = resolvePrismaCli(process.cwd());
    expect(cli).toMatch(/prisma[\\/]build[\\/]index\.js$/);
    expect(fs.existsSync(cli)).toBe(true);
  });

  it("throws a clear error when prisma cannot be resolved from the base dir", () => {
    // A directory with no reachable node_modules/prisma (filesystem root).
    expect(() => resolvePrismaCli("/")).toThrow();
  });
});
