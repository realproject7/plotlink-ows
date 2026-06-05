import { createRequire } from "module";
import fs from "fs";
import path from "path";

/**
 * Absolute path to the locally-installed Prisma CLI entry (`prisma/build/index.js`),
 * resolved from `baseDir` via Node module resolution — it walks up `node_modules`,
 * so it finds the CLI whether deps are nested (source checkout) or hoisted to a
 * sibling `node_modules` (a packed prod-only / global install).
 *
 * Startup runs `db push` by invoking this with `node <cli>` instead of
 * `npx prisma` (#479). `npx prisma` resolves relative to the process cwd and, if
 * it can't find the bin there, tries to DOWNLOAD prisma from the registry — so a
 * packed prod-only install started from an unexpected cwd, or any offline/sealed
 * environment, would hang or exit during `db push`. Resolving the local CLI
 * explicitly removes both the network dependency and the cwd ambiguity.
 *
 * Throws a clear error (caught and surfaced by the caller) if the CLI can't be
 * found — that means a corrupted install missing the `prisma` runtime dependency.
 */
export function resolvePrismaCli(baseDir: string): string {
  // The referrer file need not exist; createRequire only uses its directory as
  // the module-resolution base.
  const requireFrom = createRequire(path.join(baseDir, "__prisma-cli-resolver__.js"));
  const pkgJsonPath = requireFrom.resolve("prisma/package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { bin?: string | Record<string, string> };
  const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.prisma;
  if (!binRel) {
    throw new Error(`the installed 'prisma' package has no bin entry (resolved ${pkgJsonPath})`);
  }
  return path.join(path.dirname(pkgJsonPath), binRel);
}
