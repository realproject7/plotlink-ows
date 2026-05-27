import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { readStoryMeta } from "../routes/stories";

describe("rollback data compatibility", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("cartoon .story.json is safely ignored by fiction scanner", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".story.json"),
      JSON.stringify({ contentType: "cartoon", language: "Korean" }),
    );
    const meta = readStoryMeta(tmpDir);
    expect(meta.contentType).toBe("cartoon");
    expect(meta.language).toBe("Korean");
  });

  it("cuts.json in story dir does not affect .md file listing", () => {
    fs.writeFileSync(path.join(tmpDir, "structure.md"), "# Test");
    fs.writeFileSync(path.join(tmpDir, "plot-01.cuts.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "plot-01.md"), "content");

    const mdFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".md"));
    expect(mdFiles).toEqual(["plot-01.md", "structure.md"]);
    expect(mdFiles).not.toContain("plot-01.cuts.json");
  });

  it(".publish-status.json survives alongside new files", () => {
    const status = { "genesis.md": { file: "genesis.md", status: "published", txHash: "0x123" } };
    fs.writeFileSync(path.join(tmpDir, ".publish-status.json"), JSON.stringify(status));
    fs.writeFileSync(path.join(tmpDir, ".story.json"), JSON.stringify({ contentType: "cartoon" }));
    fs.writeFileSync(path.join(tmpDir, "plot-01.cuts.json"), "{}");

    const loaded = JSON.parse(fs.readFileSync(path.join(tmpDir, ".publish-status.json"), "utf-8"));
    expect(loaded["genesis.md"].txHash).toBe("0x123");
  });

  it("terminal-sessions.json format is unchanged", () => {
    const sessions = {
      "my-story": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "other-story": "f0e1d2c3-b4a5-6789-0fed-cba987654321",
    };
    const json = JSON.stringify(sessions, null, 2);
    const parsed = JSON.parse(json);

    expect(typeof parsed).toBe("object");
    expect(typeof parsed["my-story"]).toBe("string");
    expect(parsed["my-story"]).toMatch(/^[a-f0-9-]+$/);
  });

  it("local DB file and .env config survive alongside new files", () => {
    const dataDir = path.join(tmpDir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "local.db"), "sqlite-data");
    fs.writeFileSync(path.join(tmpDir, ".env"), "OWS_PASSPHRASE_HASH=abc123");

    fs.writeFileSync(path.join(tmpDir, ".story.json"), '{"contentType":"cartoon"}');

    expect(fs.existsSync(path.join(dataDir, "local.db"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, ".env"), "utf-8")).toContain("OWS_PASSPHRASE_HASH");
  });

  it("unknown files in story dir do not crash scanning", () => {
    fs.writeFileSync(path.join(tmpDir, "structure.md"), "# Test");
    fs.writeFileSync(path.join(tmpDir, "notes.txt"), "random");
    fs.writeFileSync(path.join(tmpDir, "image.png"), "binary");
    fs.mkdirSync(path.join(tmpDir, "assets"), { recursive: true });

    const mdFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".md"));
    expect(mdFiles).toEqual(["structure.md"]);
  });

  it("story with both fiction and cartoon files is valid", () => {
    fs.writeFileSync(path.join(tmpDir, "structure.md"), "# My Story");
    fs.writeFileSync(path.join(tmpDir, "genesis.md"), "Hook text");
    fs.writeFileSync(path.join(tmpDir, "plot-01.md"), "Chapter");
    fs.writeFileSync(path.join(tmpDir, "plot-01.cuts.json"), '{"version":1}');
    fs.writeFileSync(path.join(tmpDir, ".story.json"), '{"contentType":"cartoon"}');
    fs.mkdirSync(path.join(tmpDir, "assets", "plot-01"), { recursive: true });

    const entries = fs.readdirSync(tmpDir);
    expect(entries.length).toBeGreaterThan(3);

    const mdFiles = entries.filter((f) => f.endsWith(".md"));
    expect(mdFiles).toContain("structure.md");
    expect(mdFiles).toContain("genesis.md");
    expect(mdFiles).toContain("plot-01.md");
  });
});
