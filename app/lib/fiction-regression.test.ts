import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { readStoryMeta } from "../routes/stories";
import { getContentTypeForPublish } from "../web/lib/publish-helpers";

describe("fiction regression", () => {
  it("readStoryMeta defaults to fiction when .story.json is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fiction-reg-"));
    try {
      const meta = readStoryMeta(tmpDir);
      expect(meta.contentType).toBe("fiction");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("story scanner filters .md files only", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fiction-reg-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "structure.md"), "# Test");
      fs.writeFileSync(path.join(tmpDir, "genesis.md"), "# Hook");
      fs.writeFileSync(path.join(tmpDir, ".story.json"), '{"contentType":"fiction"}');
      fs.writeFileSync(path.join(tmpDir, "plot-01.cuts.json"), "{}");

      const entries = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".md"));
      expect(entries).toContain("structure.md");
      expect(entries).toContain("genesis.md");
      expect(entries).not.toContain(".story.json");
      expect(entries).not.toContain("plot-01.cuts.json");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fiction publish payload omits contentType", () => {
    const ct = getContentTypeForPublish({ "my-fiction": "fiction" }, "my-fiction", undefined);
    expect(ct).toBeUndefined();
  });

  it("fiction plot publish omits contentType", () => {
    const ct = getContentTypeForPublish({ "my-fiction": "fiction" }, "my-fiction", 42);
    expect(ct).toBeUndefined();
  });

  it("readStoryMeta reads fiction contentType correctly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fiction-reg-"));
    try {
      fs.writeFileSync(path.join(tmpDir, ".story.json"), JSON.stringify({ contentType: "fiction" }));
      const meta = readStoryMeta(tmpDir);
      expect(meta.contentType).toBe("fiction");
      expect(meta.language).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fiction story with .story.json has no cartoon-specific fields", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fiction-reg-"));
    try {
      fs.writeFileSync(path.join(tmpDir, ".story.json"), JSON.stringify({ contentType: "fiction" }));
      const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, ".story.json"), "utf-8"));
      expect(raw.contentType).toBe("fiction");
      expect(raw.cuts).toBeUndefined();
      expect(raw.overlays).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
