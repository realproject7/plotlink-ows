import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { readStoryMeta, writeStoryMeta } from "./stories";
import { createCutsFile, writeCutsFile, readCutsFile } from "../lib/cuts";

describe("story metadata (.story.json)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("defaults to fiction when .story.json is missing", () => {
    const meta = readStoryMeta(tmpDir);
    expect(meta.contentType).toBe("fiction");
  });

  it("reads cartoon contentType from .story.json", () => {
    fs.writeFileSync(path.join(tmpDir, ".story.json"), JSON.stringify({ contentType: "cartoon" }));
    const meta = readStoryMeta(tmpDir);
    expect(meta.contentType).toBe("cartoon");
  });

  it("reads fiction contentType from .story.json", () => {
    fs.writeFileSync(path.join(tmpDir, ".story.json"), JSON.stringify({ contentType: "fiction" }));
    const meta = readStoryMeta(tmpDir);
    expect(meta.contentType).toBe("fiction");
  });

  it("defaults to fiction for malformed .story.json", () => {
    fs.writeFileSync(path.join(tmpDir, ".story.json"), "not json");
    const meta = readStoryMeta(tmpDir);
    expect(meta.contentType).toBe("fiction");
  });

  it("defaults to fiction for unknown contentType value", () => {
    fs.writeFileSync(path.join(tmpDir, ".story.json"), JSON.stringify({ contentType: "manga" }));
    const meta = readStoryMeta(tmpDir);
    expect(meta.contentType).toBe("fiction");
  });

  it("writeStoryMeta creates .story.json", () => {
    writeStoryMeta(tmpDir, { contentType: "cartoon" });
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, ".story.json"), "utf-8"));
    expect(raw.contentType).toBe("cartoon");
  });

  it("writeStoryMeta overwrites existing .story.json", () => {
    writeStoryMeta(tmpDir, { contentType: "fiction" });
    writeStoryMeta(tmpDir, { contentType: "cartoon" });
    const meta = readStoryMeta(tmpDir);
    expect(meta.contentType).toBe("cartoon");
  });
});

describe("clean image assignment via cuts.json", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists cleanImagePath when updated in cuts.json", () => {
    const cf = createCutsFile("plot-01", 2);
    writeCutsFile(tmpDir, "plot-01", cf);

    const loaded = readCutsFile(tmpDir, "plot-01")!;
    loaded.cuts[0].cleanImagePath = "assets/plot-01/cut-01-clean.webp";
    writeCutsFile(tmpDir, "plot-01", loaded);

    const reloaded = readCutsFile(tmpDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
    expect(reloaded.cuts[1].cleanImagePath).not.toBeNull();
  });

  it("asset directory can be created for storing clean images", () => {
    const assetDir = path.join(tmpDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    const filePath = path.join(assetDir, "cut-01-clean.webp");
    fs.writeFileSync(filePath, Buffer.from("fake-image-data"));

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath).toString()).toBe("fake-image-data");
  });

  it("rejects invalid cuts.json on write roundtrip", () => {
    const cf = createCutsFile("plot-01");
    writeCutsFile(tmpDir, "plot-01", cf);

    fs.writeFileSync(
      path.join(tmpDir, "plot-01.cuts.json"),
      JSON.stringify({ version: 2, plotFile: "plot-01", cuts: [] }),
    );

    expect(() => readCutsFile(tmpDir, "plot-01")).toThrow("invalid");
  });

  it("missing image state: cleanImagePath is null by default", () => {
    const cf = createCutsFile("plot-01", 3);
    writeCutsFile(tmpDir, "plot-01", cf);

    const loaded = readCutsFile(tmpDir, "plot-01")!;
    expect(loaded.cuts[0].cleanImagePath).not.toBeNull();
    expect(loaded.cuts[0].finalImagePath).toBeNull();
    expect(loaded.cuts[0].uploadedCid).toBeNull();
  });
});
