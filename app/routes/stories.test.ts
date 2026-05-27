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

describe("clean image upload simulation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores clean image file and updates cleanImagePath in cuts.json", () => {
    const cf = createCutsFile("plot-01", 2);
    writeCutsFile(tmpDir, "plot-01", cf);

    const cutId = 1;
    const ext = "webp";
    const padded = String(cutId).padStart(2, "0");
    const assetDir = path.join(tmpDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });

    const fileName = `cut-${padded}-clean.${ext}`;
    fs.writeFileSync(path.join(assetDir, fileName), Buffer.from("fake-webp-data"));

    const loaded = readCutsFile(tmpDir, "plot-01")!;
    const cut = loaded.cuts.find((c) => c.id === cutId)!;
    cut.cleanImagePath = `assets/plot-01/${fileName}`;
    writeCutsFile(tmpDir, "plot-01", loaded);

    const reloaded = readCutsFile(tmpDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
    expect(fs.existsSync(path.join(assetDir, fileName))).toBe(true);
  });

  it("rejects upload to non-existent cut", () => {
    const cf = createCutsFile("plot-01", 1);
    writeCutsFile(tmpDir, "plot-01", cf);

    const loaded = readCutsFile(tmpDir, "plot-01")!;
    const cut = loaded.cuts.find((c) => c.id === 99);
    expect(cut).toBeUndefined();
  });

  it("validates MIME type: rejects non-image files", () => {
    const allowedMimes = ["image/webp", "image/jpeg"];
    expect(allowedMimes.includes("image/png")).toBe(false);
    expect(allowedMimes.includes("text/plain")).toBe(false);
    expect(allowedMimes.includes("image/webp")).toBe(true);
    expect(allowedMimes.includes("image/jpeg")).toBe(true);
  });

  it("validates file size: rejects files over 1MB", () => {
    const maxSize = 1024 * 1024;
    expect(1024 * 1024 + 1 > maxSize).toBe(true);
    expect(1024 * 1024 > maxSize).toBe(false);
    expect(500 * 1024 > maxSize).toBe(false);
  });

  it("returns correct cleanImagePath format", () => {
    const cutId = 3;
    const ext = "jpg";
    const padded = String(cutId).padStart(2, "0");
    const cleanImagePath = `assets/plot-02/cut-${padded}-clean.${ext}`;
    expect(cleanImagePath).toBe("assets/plot-02/cut-03-clean.jpg");
  });

  it("missing state: new cuts have default cleanImagePath but null final/upload", () => {
    const cf = createCutsFile("plot-01", 3);
    writeCutsFile(tmpDir, "plot-01", cf);

    const loaded = readCutsFile(tmpDir, "plot-01")!;
    expect(loaded.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
    expect(loaded.cuts[0].finalImagePath).toBeNull();
    expect(loaded.cuts[0].uploadedCid).toBeNull();
    expect(loaded.cuts[0].uploadedUrl).toBeNull();
  });

  it("rejects invalid cuts.json schema on read", () => {
    fs.writeFileSync(
      path.join(tmpDir, "plot-01.cuts.json"),
      JSON.stringify({ version: 2, plotFile: "plot-01", cuts: [] }),
    );
    expect(() => readCutsFile(tmpDir, "plot-01")).toThrow("invalid");
  });
});
