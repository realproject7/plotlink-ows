import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { readStoryMeta, writeStoryMeta } from "./stories";

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
