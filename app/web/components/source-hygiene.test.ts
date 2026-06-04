// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// #437: a literal NUL byte slipped into WorkflowCoach.tsx's targetKey separator,
// making the source read as binary to `file` / `rg` and able to hide future code
// from review. Guard the whole components tree so no source file can carry a raw
// NUL byte again (printable separators only).
const COMPONENTS_DIR = __dirname;
const SOURCE_EXT = new Set([".ts", ".tsx"]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return SOURCE_EXT.has(path.extname(entry.name)) ? [full] : [];
  });
}

describe("source hygiene (#437)", () => {
  it("no component source file contains a literal NUL byte", () => {
    const offenders = sourceFiles(COMPONENTS_DIR).filter((file) =>
      fs.readFileSync(file).includes(0),
    );
    expect(offenders.map((f) => path.relative(COMPONENTS_DIR, f))).toEqual([]);
  });
});
