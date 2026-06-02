// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const testState = vi.hoisted(() => ({ storiesDir: "" }));

vi.mock("../lib/paths", () => ({
  get STORIES_DIR() { return testState.storiesDir; },
  CONFIG_DIR: os.tmpdir(),
  DATA_DIR: os.tmpdir(),
  DB_PATH: path.join(os.tmpdir(), "test.db"),
  DATABASE_URL: "file:" + path.join(os.tmpdir(), "test.db"),
  ENV_FILE: path.join(os.tmpdir(), ".env"),
}));

vi.mock("../lib/generate-story-instructions", () => ({
  writeStoryInstructions: vi.fn(),
}));

import { storiesRoutes } from "./stories";
import { createCutsFile, writeCutsFile, readCutsFile } from "../lib/cuts";
import { Hono } from "hono";

const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00, 0x00,
]);

// #302: detect + repair stale cartoon asset paths in cuts.json.
describe("stale cartoon asset paths (#302)", () => {
  let tmpDir: string;
  let app: Hono;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stale-asset-"));
    testState.storiesDir = tmpDir;
    app = new Hono();
    app.route("/api/stories", storiesRoutes);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  /** Seed a cartoon story with `n` cuts, applying per-cut overrides. */
  function seed(name: string, n: number, overrides: Record<number, Record<string, unknown>> = {}) {
    const storyDir = path.join(tmpDir, name);
    fs.mkdirSync(storyDir, { recursive: true });
    const cutsFile = createCutsFile("plot-01", n);
    for (const cut of cutsFile.cuts) {
      Object.assign(cut, overrides[cut.id] ?? {});
    }
    writeCutsFile(storyDir, "plot-01", cutsFile);
    return storyDir;
  }

  function writeAsset(storyDir: string, rel: string, bytes: Buffer = WEBP) {
    const abs = path.join(storyDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes);
  }

  it("detect-clean-images reports a recorded path whose file is missing as stale, with a precise message", async () => {
    const storyDir = seed("detect-stale", 2, {
      1: { cleanImagePath: "assets/plot-01/cut-01-clean.webp" }, // no file on disk → stale
      2: { cleanImagePath: "assets/plot-01/cut-02-clean.webp" }, // valid file written below
    });
    writeAsset(storyDir, "assets/plot-01/cut-02-clean.webp");

    const res = await app.request("/api/stories/detect-stale/cuts/plot-01/detect-clean-images");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only cut 1 (missing file) is stale; cut 2's valid path is not flagged.
    expect(body.stale).toEqual([
      {
        cutId: 1,
        field: "cleanImagePath",
        path: "assets/plot-01/cut-01-clean.webp",
        message: "Cut 1 clean image path is recorded but the file is missing",
      },
    ]);
  });

  it("sync clears a stale cleanImagePath without deleting valid files, and preserves a valid path", async () => {
    const storyDir = seed("sync-repair", 2, {
      1: { cleanImagePath: "assets/plot-01/cut-01-clean.webp" }, // missing → cleared
      2: { cleanImagePath: "assets/plot-01/cut-02-clean.webp" }, // valid → preserved
    });
    writeAsset(storyDir, "assets/plot-01/cut-02-clean.webp");

    const res = await app.request("/api/stories/sync-repair/cuts/plot-01/sync-clean-images", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toBe(true);
    expect(body.cleared).toEqual([1]);

    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBeNull(); // stale cleared
    expect(reloaded.cuts[1].cleanImagePath).toBe("assets/plot-01/cut-02-clean.webp"); // valid preserved
    // The valid file is NOT deleted by the repair.
    expect(fs.existsSync(path.join(storyDir, "assets/plot-01/cut-02-clean.webp"))).toBe(true);
  });

  it("sync leaves a fully-valid cut plan unchanged (valid cleanImagePath preserved)", async () => {
    const storyDir = seed("sync-valid", 1, {
      1: { cleanImagePath: "assets/plot-01/cut-01-clean.webp" },
    });
    writeAsset(storyDir, "assets/plot-01/cut-01-clean.webp");

    const res = await app.request("/api/stories/sync-valid/cuts/plot-01/sync-clean-images", { method: "POST" });
    const body = await res.json();
    expect(body.changed).toBe(false);
    expect(body.cleared).toEqual([]);
    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
  });
});
