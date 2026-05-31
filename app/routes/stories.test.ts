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

import { readStoryMeta, writeStoryMeta, storiesRoutes, saveExportedCut } from "./stories";
import { createCutsFile, writeCutsFile, readCutsFile } from "../lib/cuts";
import { Hono } from "hono";

describe("story metadata (.story.json)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-test-"));
    testState.storiesDir = tmpDir;
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

  it("persists language in .story.json", () => {
    writeStoryMeta(tmpDir, { contentType: "cartoon", language: "Korean" });
    const meta = readStoryMeta(tmpDir);
    expect(meta.contentType).toBe("cartoon");
    expect(meta.language).toBe("Korean");
  });

  it("defaults language to undefined when not set", () => {
    writeStoryMeta(tmpDir, { contentType: "fiction" });
    const meta = readStoryMeta(tmpDir);
    expect(meta.language).toBeUndefined();
  });

  it("persists agentMode bypass in .story.json", () => {
    writeStoryMeta(tmpDir, { contentType: "cartoon", agentMode: "bypass" });
    const meta = readStoryMeta(tmpDir);
    expect(meta.agentMode).toBe("bypass");
  });

  it("defaults agentMode to undefined (normal) when not set", () => {
    writeStoryMeta(tmpDir, { contentType: "fiction" });
    const meta = readStoryMeta(tmpDir);
    expect(meta.agentMode).toBeUndefined();
  });

  it("ignores invalid agentMode values", () => {
    fs.writeFileSync(path.join(tmpDir, ".story.json"), JSON.stringify({ contentType: "cartoon", agentMode: "yolo" }));
    const meta = readStoryMeta(tmpDir);
    expect(meta.agentMode).toBeUndefined();
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
    testState.storiesDir = tmpDir;
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

  it("missing state: new cuts have null cleanImagePath, finalImagePath, and upload fields", () => {
    const cf = createCutsFile("plot-01", 3);
    writeCutsFile(tmpDir, "plot-01", cf);

    const loaded = readCutsFile(tmpDir, "plot-01")!;
    expect(loaded.cuts[0].cleanImagePath).toBeNull();
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

describe("POST /upload-clean/:cutId route", () => {
  let tmpDir: string;
  let app: Hono;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-route-"));
    testState.storiesDir = tmpDir;
    app = new Hono();
    app.route("/api/stories", storiesRoutes);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function postEmpty(url: string) {
    const fd = new FormData();
    return app.request(url, { method: "POST", body: fd });
  }

  it("rejects upload for non-existent cut via route", async () => {
    const storyDir = path.join(tmpDir, "test-story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01"));

    const res = await app.request("/api/stories/test-story/cuts/plot-01/upload-clean/99", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: "dummy",
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Cut 99");
  });

  it("rejects upload without file via route", async () => {
    const storyDir = path.join(tmpDir, "test-story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01"));

    const res = await postEmpty("/api/stories/test-story/cuts/plot-01/upload-clean/1");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No file");
  });

  it("returns 404 for missing story via route", async () => {
    const res = await postEmpty("/api/stories/nonexistent/cuts/plot-01/upload-clean/1");

    expect(res.status).toBe(404);
  });

  it("GET cuts returns 404 when cuts file is missing", async () => {
    const storyDir = path.join(tmpDir, "no-cuts-story");
    fs.mkdirSync(storyDir, { recursive: true });

    const res = await app.request("/api/stories/no-cuts-story/cuts/plot-01");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
  });

  it("GET cuts returns 400 with validation error for invalid schema", async () => {
    const storyDir = path.join(tmpDir, "bad-cuts-story");
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(
      path.join(storyDir, "plot-01.cuts.json"),
      JSON.stringify({ version: 1, plotFile: "plot-01", cuts: [{ id: "c01", shot: "wide" }] }),
    );

    const res = await app.request("/api/stories/bad-cuts-story/cuts/plot-01");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("invalid");
  });

  it("GET cuts returns 400 for malformed JSON", async () => {
    const storyDir = path.join(tmpDir, "malformed-cuts-story");
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, "plot-01.cuts.json"), "{ not valid json");

    const res = await app.request("/api/stories/malformed-cuts-story/cuts/plot-01");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("invalid JSON");
  });

  it("detects Korean language from structure.md title without .story.json language", async () => {
    const storyDir = path.join(tmpDir, "korean-story");
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, "structure.md"), "# 한국어 이야기\n\n내용");
    writeStoryMeta(storyDir, { contentType: "cartoon" });

    const res = await app.request("/api/stories/korean-story");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.language).toBe("Korean");
  });

  it("parses explicit Language metadata from structure.md with Latin title", async () => {
    const storyDir = path.join(tmpDir, "latin-korean");
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, "structure.md"), "# The Last Hero\n\n**Language:** Korean\n\nContent");
    writeStoryMeta(storyDir, { contentType: "cartoon" });

    const res = await app.request("/api/stories/latin-korean");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.language).toBe("Korean");
  });

  it("export-final rejects missing story via route", async () => {
    const res = await postEmpty("/api/stories/nonexistent/cuts/plot-01/export-final/1");
    expect(res.status).toBe(404);
  });

  it("export-final rejects missing file via route", async () => {
    const storyDir = path.join(tmpDir, "test-story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01"));

    const res = await postEmpty("/api/stories/test-story/cuts/plot-01/export-final/1");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No file");
  });

  it("saveExportedCut saves file and updates cuts.json", () => {
    const storyDir = path.join(tmpDir, "export-story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01"));

    const buffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    const result = saveExportedCut(storyDir, "plot-01", 1, buffer, "image/jpeg");

    expect(result.finalImagePath).toBe("assets/plot-01/cut-01-final.jpg");

    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].finalImagePath).toBe("assets/plot-01/cut-01-final.jpg");
    expect(reloaded.cuts[0].exportedAt).toBeTruthy();

    const assetFile = path.join(storyDir, "assets", "plot-01", "cut-01-final.jpg");
    expect(fs.existsSync(assetFile)).toBe(true);
    expect(fs.readFileSync(assetFile)).toEqual(buffer);
  });

  it("saveExportedCut uses webp extension for image/webp", () => {
    const storyDir = path.join(tmpDir, "webp-story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01"));

    const result = saveExportedCut(storyDir, "plot-01", 1, Buffer.from([0x00]), "image/webp");
    expect(result.finalImagePath).toBe("assets/plot-01/cut-01-final.webp");
  });

  it("rejects export-final for non-existent cut via route", async () => {
    const storyDir = path.join(tmpDir, "test-story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01"));

    const res = await app.request("/api/stories/test-story/cuts/plot-01/export-final/99", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: "dummy",
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Cut 99");
  });

  it("set-uploaded stores CID and URL in cuts.json", async () => {
    const storyDir = path.join(tmpDir, "upload-story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01"));

    const res = await app.request("/api/stories/upload-story/cuts/plot-01/set-uploaded/1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cid: "QmTestCid", url: "https://ipfs.example.com/QmTestCid" }),
    });

    expect(res.status).toBe(200);
    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].uploadedCid).toBe("QmTestCid");
    expect(reloaded.cuts[0].uploadedUrl).toBe("https://ipfs.example.com/QmTestCid");
  });

  it("set-uploaded rejects non-existent cut", async () => {
    const storyDir = path.join(tmpDir, "upload-story3");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01"));

    const res = await app.request("/api/stories/upload-story3/cuts/plot-01/set-uploaded/99", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cid: "QmTest", url: "https://example.com" }),
    });
    expect(res.status).toBe(404);
  });

  it("set-uploaded rejects missing CID", async () => {
    const storyDir = path.join(tmpDir, "upload-story2");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01"));

    const res = await app.request("/api/stories/upload-story2/cuts/plot-01/set-uploaded/1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cid: "", url: "" }),
    });

    expect(res.status).toBe(400);
  });

  // Real magic-byte payloads so content sniffing accepts them.
  const WEBP_MAGIC = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00, 0x00,
  ]);
  const PNG_MAGIC = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
  ]);

  it("sync-clean-images records cleanImagePath when a valid file exists", async () => {
    const storyDir = path.join(tmpDir, "sync-story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 2));

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.webp"), WEBP_MAGIC);

    const res = await app.request("/api/stories/sync-story/cuts/plot-01/sync-clean-images", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toBe(true);
    expect(body.synced).toEqual([1]);
    expect(body.rejected).toEqual([]);

    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
    expect(reloaded.cuts[1].cleanImagePath).toBeNull();
  });

  it("sync-clean-images rejects a text file renamed to .webp (content sniff)", async () => {
    const storyDir = path.join(tmpDir, "sync-fake-webp");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 2));

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    // Valid webp for cut 1, text-content file renamed .webp for cut 2.
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.webp"), WEBP_MAGIC);
    fs.writeFileSync(path.join(assetDir, "cut-02-clean.webp"), Buffer.from("hello world"));

    const res = await app.request("/api/stories/sync-fake-webp/cuts/plot-01/sync-clean-images", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toEqual([1]);
    expect(body.rejected).toEqual([
      { cutId: 2, reason: "not a valid image (content does not match WebP/JPEG/PNG)" },
    ]);

    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
    expect(reloaded.cuts[1].cleanImagePath).toBeNull();
  });

  it("sync-clean-images rejects a .webp whose content is PNG (extension mismatch)", async () => {
    const storyDir = path.join(tmpDir, "sync-mismatch");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.webp"), PNG_MAGIC);

    const res = await app.request("/api/stories/sync-mismatch/cuts/plot-01/sync-clean-images", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toBe(false);
    expect(body.synced).toEqual([]);
    expect(body.rejected).toEqual([
      { cutId: 1, reason: "content does not match .webp extension" },
    ]);

    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBeNull();
  });

  it("sync-clean-images rejects an oversized file and does not record it", async () => {
    const storyDir = path.join(tmpDir, "sync-big");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.webp"), Buffer.alloc(1024 * 1024 + 10));

    const res = await app.request("/api/stories/sync-big/cuts/plot-01/sync-clean-images", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toBe(false);
    expect(body.synced).toEqual([]);
    expect(body.rejected).toEqual([{ cutId: 1, reason: "File must be under 1MB" }]);

    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBeNull();
  });

  it("sync-clean-images ignores files with an invalid extension", async () => {
    const storyDir = path.join(tmpDir, "sync-bad-ext");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.txt"), Buffer.from("not an image"));

    const res = await app.request("/api/stories/sync-bad-ext/cuts/plot-01/sync-clean-images", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toBe(false);
    expect(body.synced).toEqual([]);
    expect(body.rejected).toEqual([{ cutId: 1, reason: "Unsupported extension .txt" }]);

    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBeNull();
  });

  it("sync-clean-images is idempotent on a second run", async () => {
    const storyDir = path.join(tmpDir, "sync-idem");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.webp"), WEBP_MAGIC);

    const first = await (await app.request("/api/stories/sync-idem/cuts/plot-01/sync-clean-images", { method: "POST" })).json();
    expect(first.changed).toBe(true);

    const second = await (await app.request("/api/stories/sync-idem/cuts/plot-01/sync-clean-images", { method: "POST" })).json();
    expect(second.changed).toBe(false);
    expect(second.synced).toEqual([]);
  });

  it("sync-clean-images returns 404 for missing story", async () => {
    const res = await app.request("/api/stories/nope/cuts/plot-01/sync-clean-images", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("sync-clean-images returns 404 when cuts file is missing", async () => {
    const storyDir = path.join(tmpDir, "sync-no-cuts");
    fs.mkdirSync(storyDir, { recursive: true });
    const res = await app.request("/api/stories/sync-no-cuts/cuts/plot-01/sync-clean-images", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("defaults language to English when no CJK in title", async () => {
    const storyDir = path.join(tmpDir, "english-story");
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, "structure.md"), "# The Last Hero\n\nContent");
    writeStoryMeta(storyDir, { contentType: "fiction" });

    const res = await app.request("/api/stories/english-story");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.language).toBe("English");
  });

  it("sync-clean-images does NOT record a .png file (png no longer accepted)", async () => {
    const storyDir = path.join(tmpDir, "sync-png");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.png"), PNG_MAGIC);

    const res = await app.request("/api/stories/sync-png/cuts/plot-01/sync-clean-images", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toBe(false);
    expect(body.synced).toEqual([]);
    // .png is rejected with an unsupported-extension reason (surfaced via dir scan).
    expect(body.rejected).toEqual([{ cutId: 1, reason: "Unsupported extension .png" }]);

    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBeNull();
  });

  it("detect-clean-images returns the cut id when a valid webp exists and cleanImagePath is null", async () => {
    const storyDir = path.join(tmpDir, "detect-ok");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 2));

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.webp"), WEBP_MAGIC);

    const cutsPath = path.join(storyDir, "plot-01.cuts.json");
    const before = fs.readFileSync(cutsPath, "utf-8");

    const res = await app.request("/api/stories/detect-ok/cuts/plot-01/detect-clean-images");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detected).toEqual([1]);

    // detect must NOT mutate cuts.json.
    const after = fs.readFileSync(cutsPath, "utf-8");
    expect(after).toBe(before);
    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBeNull();
  });

  it("detect-clean-images returns empty when no clean file exists", async () => {
    const storyDir = path.join(tmpDir, "detect-none");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 2));

    const res = await app.request("/api/stories/detect-none/cuts/plot-01/detect-clean-images");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detected).toEqual([]);
  });

  it("detect-clean-images excludes a cut that already has a cleanImagePath", async () => {
    const storyDir = path.join(tmpDir, "detect-has-path");
    fs.mkdirSync(storyDir, { recursive: true });
    const cf = createCutsFile("plot-01", 1);
    cf.cuts[0].cleanImagePath = "assets/plot-01/cut-01-clean.webp";
    writeCutsFile(storyDir, "plot-01", cf);

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.webp"), WEBP_MAGIC);

    const res = await app.request("/api/stories/detect-has-path/cuts/plot-01/detect-clean-images");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detected).toEqual([]);
  });

  it("detect-clean-images excludes a content-mismatched (png-in-webp) file", async () => {
    const storyDir = path.join(tmpDir, "detect-mismatch");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.webp"), PNG_MAGIC);

    const res = await app.request("/api/stories/detect-mismatch/cuts/plot-01/detect-clean-images");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detected).toEqual([]);
  });

  it("detect-clean-images excludes an oversized file", async () => {
    const storyDir = path.join(tmpDir, "detect-big");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.webp"), Buffer.alloc(1024 * 1024 + 10));

    const res = await app.request("/api/stories/detect-big/cuts/plot-01/detect-clean-images");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detected).toEqual([]);
  });

  it("detect-clean-images excludes a .png file (png no longer accepted)", async () => {
    const storyDir = path.join(tmpDir, "detect-png");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const assetDir = path.join(storyDir, "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.png"), PNG_MAGIC);

    const res = await app.request("/api/stories/detect-png/cuts/plot-01/detect-clean-images");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detected).toEqual([]);
  });
});
