// @vitest-environment node
// Node env (not jsdom): this is a pure fs/Hono route test, and multipart
// FormData upload bodies only serialize correctly under the node environment
// (jsdom's FormData/File do not set a multipart boundary for c.req.formData()).
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
import { CARTOON_BUBBLE_RENDERER_VERSION } from "../lib/overlays";
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

  // #424: publish metadata (genre / is-NSFW / title / description) read from
  // .story.json so the publish controls seed real values, not Romance/English.
  it("reads genre, isNsfw, title, description from .story.json", () => {
    fs.writeFileSync(path.join(tmpDir, ".story.json"), JSON.stringify({
      contentType: "cartoon", language: "Korean", genre: "Science Fiction",
      isNsfw: true, title: "신의 세포", description: "A cell awakens.",
    }));
    const meta = readStoryMeta(tmpDir);
    expect(meta.genre).toBe("Science Fiction");
    expect(meta.isNsfw).toBe(true);
    expect(meta.title).toBe("신의 세포");
    expect(meta.description).toBe("A cell awakens.");
  });

  it("accepts snake_case is_nsfw and normalizes to isNsfw on read", () => {
    fs.writeFileSync(path.join(tmpDir, ".story.json"), JSON.stringify({ contentType: "cartoon", is_nsfw: true }));
    expect(readStoryMeta(tmpDir).isNsfw).toBe(true);
  });

  it("leaves genre/isNsfw undefined when absent (⇒ client shows Needs metadata)", () => {
    fs.writeFileSync(path.join(tmpDir, ".story.json"), JSON.stringify({ contentType: "fiction" }));
    const meta = readStoryMeta(tmpDir);
    expect(meta.genre).toBeUndefined();
    expect(meta.isNsfw).toBeUndefined();
  });

  it("round-trips genre/isNsfw through writeStoryMeta", () => {
    writeStoryMeta(tmpDir, { contentType: "cartoon", genre: "Romance", isNsfw: false });
    const meta = readStoryMeta(tmpDir);
    expect(meta.genre).toBe("Romance");
    expect(meta.isNsfw).toBe(false);
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

  it("persists agentProvider codex in .story.json", () => {
    writeStoryMeta(tmpDir, { contentType: "cartoon", agentProvider: "codex" });
    const meta = readStoryMeta(tmpDir);
    expect(meta.agentProvider).toBe("codex");
  });

  it("defaults agentProvider to undefined when not set", () => {
    writeStoryMeta(tmpDir, { contentType: "cartoon" });
    const meta = readStoryMeta(tmpDir);
    expect(meta.agentProvider).toBeUndefined();
  });

  it("ignores invalid agentProvider values", () => {
    fs.writeFileSync(path.join(tmpDir, ".story.json"), JSON.stringify({ contentType: "cartoon", agentProvider: "gemini" }));
    const meta = readStoryMeta(tmpDir);
    expect(meta.agentProvider).toBeUndefined();
  });
});

describe("GET /api/stories — agentProvider exposure (read-only)", () => {
  let tmpDir: string;
  let app: Hono;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-prov-"));
    testState.storiesDir = tmpDir;
    app = new Hono();
    app.route("/api/stories", storiesRoutes);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedStory(name: string, meta: Record<string, unknown>) {
    const storyDir = path.join(tmpDir, name);
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, ".story.json"), JSON.stringify(meta));
    fs.writeFileSync(path.join(storyDir, "structure.md"), "# Title\n");
    return storyDir;
  }

  it("lists a legacy cartoon (no agentProvider) with agentProvider absent/undefined", async () => {
    seedStory("legacy-cartoon", { contentType: "cartoon" });
    const res = await app.request("/api/stories");
    expect(res.status).toBe(200);
    const body = await res.json();
    const story = body.stories.find((s: { name: string }) => s.name === "legacy-cartoon");
    expect(story.contentType).toBe("cartoon");
    expect(story.agentProvider).toBeUndefined();
  });

  it("lists a cartoon with agentProvider codex as codex", async () => {
    seedStory("codex-cartoon", { contentType: "cartoon", agentProvider: "codex" });
    const res = await app.request("/api/stories");
    const body = await res.json();
    const story = body.stories.find((s: { name: string }) => s.name === "codex-cartoon");
    expect(story.agentProvider).toBe("codex");
  });

  it("lists a fiction story with agentProvider absent/undefined", async () => {
    seedStory("plain-fiction", { contentType: "fiction" });
    const res = await app.request("/api/stories");
    const body = await res.json();
    const story = body.stories.find((s: { name: string }) => s.name === "plain-fiction");
    expect(story.contentType).toBe("fiction");
    expect(story.agentProvider).toBeUndefined();
  });

  it("repair POST {contentType:cartoon, agentProvider:codex} sets provider AND preserves language/agentMode", async () => {
    const storyDir = seedStory("repair-me", {
      contentType: "cartoon",
      language: "Korean",
      agentMode: "bypass",
    });

    const res = await app.request("/api/stories/repair-me/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "cartoon", agentProvider: "codex" }),
    });
    expect(res.status).toBe(200);

    const meta = readStoryMeta(storyDir);
    expect(meta.agentProvider).toBe("codex");
    expect(meta.contentType).toBe("cartoon");
    // Preserved via the route's `...existing` spread — repair must not wipe these.
    expect(meta.language).toBe("Korean");
    expect(meta.agentMode).toBe("bypass");
  });

  // #424: the publish controls read these off the story detail/list response.
  it("GET /:name surfaces genre/isNsfw/language from .story.json (god-cell)", async () => {
    seedStory("god-cell", { contentType: "cartoon", language: "Korean", genre: "Science Fiction", isNsfw: false });
    const res = await app.request("/api/stories/god-cell");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.language).toBe("Korean");
    expect(body.genre).toBe("Science Fiction");
    expect(body.isNsfw).toBe(false);
  });

  it("omits genre/isNsfw when .story.json has none (⇒ Needs metadata on the client)", async () => {
    seedStory("bare", { contentType: "cartoon" });
    const res = await app.request("/api/stories/bare");
    const body = await res.json();
    expect(body.genre).toBeUndefined();
    expect(body.isNsfw).toBeUndefined();
  });

  it("POST /:name/publish-metadata persists genre/language/isNsfw without touching contentType", async () => {
    const storyDir = seedStory("persist-me", { contentType: "cartoon", language: "Korean", agentMode: "bypass" });
    const res = await app.request("/api/stories/persist-me/publish-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genre: "Science Fiction", language: "Korean", isNsfw: true }),
    });
    expect(res.status).toBe(200);
    const meta = readStoryMeta(storyDir);
    expect(meta.genre).toBe("Science Fiction");
    expect(meta.isNsfw).toBe(true);
    // contentType + unrelated fields preserved; CLAUDE.md not rewritten.
    expect(meta.contentType).toBe("cartoon");
    expect(meta.agentMode).toBe("bypass");
  });

  it("publish-metadata leaves omitted fields untouched (single-control edit)", async () => {
    const storyDir = seedStory("partial", { contentType: "cartoon", genre: "Romance", isNsfw: true });
    await app.request("/api/stories/partial/publish-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genre: "Horror" }),
    });
    const meta = readStoryMeta(storyDir);
    expect(meta.genre).toBe("Horror");
    expect(meta.isNsfw).toBe(true); // not clobbered by the genre-only edit
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

  // #266: validate uploads by actual file bytes, not just the (spoofable) MIME.
  const WEBP_BYTES = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00, 0x00,
  ]);
  const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function uploadClean(story: string, cutId: number, bytes: Uint8Array, mime: string, filename: string) {
    const fd = new FormData();
    fd.append("file", new File([bytes], filename, { type: mime }));
    return app.request(`/api/stories/${story}/cuts/plot-01/upload-clean/${cutId}`, {
      method: "POST",
      body: fd,
    });
  }

  function seedStory(name: string) {
    const storyDir = path.join(tmpDir, name);
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 2));
    return storyDir;
  }

  it("accepts a valid WebP upload: 200, file written, cleanImagePath recorded", async () => {
    const storyDir = seedStory("upl-webp");
    const res = await uploadClean("upl-webp", 1, WEBP_BYTES, "image/webp", "cut.webp");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
    expect(fs.existsSync(path.join(storyDir, "assets/plot-01/cut-01-clean.webp"))).toBe(true);
  });

  it("accepts a valid JPEG upload: 200, cleanImagePath recorded with .jpg", async () => {
    const storyDir = seedStory("upl-jpeg");
    const res = await uploadClean("upl-jpeg", 1, JPEG_BYTES, "image/jpeg", "cut.jpg");
    expect(res.status).toBe(200);
    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.jpg");
  });

  it("rejects a text file renamed .webp with image/webp MIME: 400, nothing written/recorded", async () => {
    const storyDir = seedStory("upl-fake");
    const text = new TextEncoder().encode("this is not an image, just text");
    const res = await uploadClean("upl-fake", 1, text, "image/webp", "cut.webp");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not a valid WebP/JPEG image");
    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBeNull();
    expect(fs.existsSync(path.join(storyDir, "assets/plot-01/cut-01-clean.webp"))).toBe(false);
  });

  it("rejects PNG bytes labeled image/webp: 400, not recorded", async () => {
    const storyDir = seedStory("upl-png");
    const res = await uploadClean("upl-png", 1, PNG_BYTES, "image/webp", "cut.webp");
    expect(res.status).toBe(400);
    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBeNull();
  });

  it("rejects a disallowed MIME (image/png) before byte validation: 400", async () => {
    const storyDir = seedStory("upl-pngmime");
    const res = await uploadClean("upl-pngmime", 1, PNG_BYTES, "image/png", "cut.png");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Only WebP and JPEG");
    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBeNull();
  });

  // #301: an oversize clean image (the browser import could not compress it
  // under 1MB, or it was uploaded directly) must be rejected without updating
  // cuts.json, so the cut plan never references an asset PlotLink would reject.
  it("rejects an oversize clean image (>1MB): 400, cleanImagePath not updated", async () => {
    const storyDir = seedStory("upl-big");
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(WEBP_BYTES, 0); // valid WebP header, but over the size limit
    const res = await uploadClean("upl-big", 1, big, "image/webp", "cut.webp");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("under 1MB");
    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].cleanImagePath).toBeNull();
    expect(fs.existsSync(path.join(storyDir, "assets/plot-01/cut-01-clean.webp"))).toBe(false);
  });

  it("GET cuts returns 404 when cuts file is missing", async () => {
    const storyDir = path.join(tmpDir, "no-cuts-story");
    fs.mkdirSync(storyDir, { recursive: true });

    const res = await app.request("/api/stories/no-cuts-story/cuts/plot-01");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
  });

  it("discovers genesis.cuts.json (Genesis-as-Episode-1, not only plot-NN) via the cuts route (#422)", async () => {
    const storyDir = path.join(tmpDir, "genesis-cuts-story");
    fs.mkdirSync(storyDir, { recursive: true });
    // plotFile "genesis" ⇒ genesis.cuts.json — OWS must not assume only plot-NN.
    writeCutsFile(storyDir, "genesis", createCutsFile("genesis", 2));

    const res = await app.request("/api/stories/genesis-cuts-story/cuts/genesis");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plotFile).toBe("genesis");
    expect(body.cuts).toHaveLength(2);
    expect(fs.existsSync(path.join(storyDir, "genesis.cuts.json"))).toBe(true);
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

  it("persists speech overlays incl. tailAnchor through PUT then GET (save → close → reopen)", async () => {
    // Mirrors the live lettering flow: the editor PUTs the cuts file on Save,
    // and reloads it via GET on reopen. The speaker/text/tail the writer set
    // must survive that round-trip byte-for-byte.
    const storyDir = path.join(tmpDir, "letter-story");
    fs.mkdirSync(storyDir, { recursive: true });
    const cutsFile = createCutsFile("plot-01");
    cutsFile.cuts[0].cleanImagePath = "assets/plot-01/cut-01-clean.webp";
    cutsFile.cuts[0].overlays = [
      {
        id: "ov-1",
        type: "speech",
        x: 0.1, y: 0.2, width: 0.25, height: 0.12,
        text: "Hello there",
        speaker: "Mira",
        tailAnchor: { x: 0.4, y: 1.35 },
        textStyle: { mode: "manual", fontScale: 0.04, fontWeight: 700, lineHeightFactor: 1.3, speakerScale: 0.85 },
        bubbleStyle: { paddingX: 0.12, paddingY: 0.1, cornerRadius: 0.25 },
      },
    ];

    const putRes = await app.request("/api/stories/letter-story/cuts/plot-01", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cutsFile),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/api/stories/letter-story/cuts/plot-01");
    expect(getRes.status).toBe(200);
    const reloaded = await getRes.json();
    const overlay = reloaded.cuts[0].overlays[0];
    expect(overlay.type).toBe("speech");
    expect(overlay.speaker).toBe("Mira");
    expect(overlay.text).toBe("Hello there");
    expect(overlay.tailAnchor).toEqual({ x: 0.4, y: 1.35 });
    expect(overlay.textStyle).toEqual({ mode: "manual", fontScale: 0.04, fontWeight: 700, lineHeightFactor: 1.3, speakerScale: 0.85 });
    expect(overlay.bubbleStyle).toEqual({ paddingX: 0.12, paddingY: 0.1, cornerRadius: 0.25 });

    // And on disk (the file the editor reopens from).
    const onDisk = readCutsFile(storyDir, "plot-01")!;
    expect(onDisk.cuts[0].overlays[0].tailAnchor).toEqual({ x: 0.4, y: 1.35 });
    expect(onDisk.cuts[0].overlays[0].textStyle).toEqual({ mode: "manual", fontScale: 0.04, fontWeight: 700, lineHeightFactor: 1.3, speakerScale: 0.85 });
    expect(onDisk.cuts[0].overlays[0].bubbleStyle).toEqual({ paddingX: 0.12, paddingY: 0.1, cornerRadius: 0.25 });
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
    // #381: the export stamps the current bubble-renderer version so a later
    // upgrade can flag this final image as stale (needing re-export).
    expect(reloaded.cuts[0].finalRendererVersion).toBe(CARTOON_BUBBLE_RENDERER_VERSION);

    const assetFile = path.join(storyDir, "assets", "plot-01", "cut-01-final.jpg");
    expect(fs.existsSync(assetFile)).toBe(true);
    expect(fs.readFileSync(assetFile)).toEqual(buffer);
  });

  // #381 (re1): re-exporting an already-uploaded cut must invalidate its prior
  // upload, or the bulk upload (which skips cuts with an uploadedCid) would keep
  // publishing the OLD image after re-export.
  it("saveExportedCut clears uploadedCid/uploadedUrl so a re-exported cut is upload-eligible again", () => {
    const storyDir = path.join(tmpDir, "reexport-story");
    fs.mkdirSync(storyDir, { recursive: true });
    const cf = createCutsFile("plot-01");
    cf.cuts[0].finalImagePath = "assets/plot-01/cut-01-final.webp";
    cf.cuts[0].uploadedCid = "QmOldStaleCid";
    cf.cuts[0].uploadedUrl = "https://ipfs.example.com/QmOldStaleCid";
    writeCutsFile(storyDir, "plot-01", cf);

    saveExportedCut(storyDir, "plot-01", 1, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");

    const reloaded = readCutsFile(storyDir, "plot-01")!;
    expect(reloaded.cuts[0].uploadedCid).toBeNull();
    expect(reloaded.cuts[0].uploadedUrl).toBeNull();
    expect(reloaded.cuts[0].finalRendererVersion).toBe(CARTOON_BUBBLE_RENDERER_VERSION);
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

  it("omits language (⇒ Needs metadata) when undetermined — no blind English default (#424)", async () => {
    const storyDir = path.join(tmpDir, "english-story");
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, "structure.md"), "# The Last Hero\n\nContent");
    writeStoryMeta(storyDir, { contentType: "fiction" });

    const res = await app.request("/api/stories/english-story");
    expect(res.status).toBe(200);
    const body = await res.json();
    // No .story.json language, no structure hint, Latin-script title ⇒ unknown.
    // The client must show "Needs metadata", not silently publish English.
    expect(body.language).toBeUndefined();
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

// Regression for #278: the real failure mode that mocked-authFetch component
// tests could not catch. The clean/final cartoon images are loaded over this
// route, and it must actually return the bytes. Before the fix the handler read
// the nested path via `c.req.param("*")`, which Hono v4 leaves empty for a
// mixed named/wildcard route, so every authenticated asset request 400'd and the
// UI showed "Image not available". These tests exercise the real Hono route.
describe("GET /:name/asset/:assetPath — serve story asset (real route)", () => {
  let tmpDir: string;
  let app: Hono;

  // Minimal valid WebP header so the bytes are recognizable in assertions.
  const WEBP_BYTES = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  ]);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-asset-"));
    testState.storiesDir = tmpDir;
    app = new Hono();
    app.route("/api/stories", storiesRoutes);

    const assetDir = path.join(tmpDir, "lanterns-after-midnight", "assets", "plot-01");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "cut-01-clean.webp"), WEBP_BYTES);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the nested clean image with the right content-type (not 400)", async () => {
    const res = await app.request(
      "/api/stories/lanterns-after-midnight/asset/plot-01/cut-01-clean.webp",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes).toEqual(WEBP_BYTES);
  });

  it("404s for a missing asset (path resolved, file absent)", async () => {
    const res = await app.request(
      "/api/stories/lanterns-after-midnight/asset/plot-01/cut-99-clean.webp",
    );
    expect(res.status).toBe(404);
  });

  it("rejects encoded path traversal that survives URL normalization", async () => {
    // Raw "../" is collapsed by the URL parser before routing; the meaningful
    // attack is percent-encoded, which reaches the handler's `..` guard intact.
    const res = await app.request(
      "/api/stories/lanterns-after-midnight/asset/%2e%2e%2f%2e%2e%2fetc/passwd",
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/stories/:name/cover-asset (#296 auto-detect)", () => {
  let tmpDir: string;
  let app: Hono;

  // RIFF…WEBP and JPEG magic bytes (mirrors the upload byte-sniff fixtures).
  const WEBP_BYTES = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00, 0x00,
  ]);
  const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-cover-"));
    testState.storiesDir = tmpDir;
    app = new Hono();
    app.route("/api/stories", storiesRoutes);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeCover(story: string, file: string, bytes: Uint8Array) {
    const dir = path.join(tmpDir, story, "assets");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), Buffer.from(bytes));
  }

  it("found:false when no cover asset exists", async () => {
    fs.mkdirSync(path.join(tmpDir, "no-cover"), { recursive: true });
    const res = await app.request("/api/stories/no-cover/cover-asset");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false });
  });

  it("detects a valid assets/cover.webp", async () => {
    writeCover("has-webp", "cover.webp", WEBP_BYTES);
    const res = await app.request("/api/stories/has-webp/cover-asset");
    const data = await res.json();
    expect(data).toMatchObject({ found: true, valid: true, path: "assets/cover.webp", type: "image/webp" });
  });

  it("detects a valid assets/cover.jpg", async () => {
    writeCover("has-jpg", "cover.jpg", JPEG_BYTES);
    const data = await (await app.request("/api/stories/has-jpg/cover-asset")).json();
    expect(data).toMatchObject({ found: true, valid: true, path: "assets/cover.jpg", type: "image/jpeg" });
  });

  it("flags a spoofed cover (PNG bytes named cover.webp) as invalid, not offered", async () => {
    writeCover("spoofed", "cover.webp", PNG_BYTES);
    const data = await (await app.request("/api/stories/spoofed/cover-asset")).json();
    expect(data.found).toBe(true);
    expect(data.valid).toBe(false);
    expect(data.error).toMatch(/not a valid WEBP/i);
  });

  it("flags an oversize cover as invalid", async () => {
    // 1MB + 1 byte, valid WEBP header.
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(WEBP_BYTES, 0);
    writeCover("oversize", "cover.webp", big);
    const data = await (await app.request("/api/stories/oversize/cover-asset")).json();
    expect(data).toMatchObject({ found: true, valid: false });
    expect(data.error).toMatch(/exceeds the 1MB/i);
  });

  it("prefers cover.webp over cover.jpg when both exist", async () => {
    writeCover("both", "cover.webp", WEBP_BYTES);
    writeCover("both", "cover.jpg", JPEG_BYTES);
    const data = await (await app.request("/api/stories/both/cover-asset")).json();
    expect(data.path).toBe("assets/cover.webp");
  });
});

describe("generate-markdown produces publish-ready cartoon markdown (#319)", () => {
  let tmpDir: string;
  let app: Hono;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-test-"));
    testState.storiesDir = tmpDir;
    app = new Hono();
    app.route("/api/stories", storiesRoutes);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedCuts(story: string, urls: (string | null)[]) {
    const storyDir = path.join(tmpDir, story);
    fs.mkdirSync(storyDir, { recursive: true });
    const cf = createCutsFile("plot-01", urls.length);
    cf.cuts.forEach((cut, i) => {
      cut.description = `Scene ${i + 1}`;
      cut.uploadedUrl = urls[i];
    });
    writeCutsFile(storyDir, "plot-01", cf);
    return storyDir;
  }

  it("rewrites a scaffold-prose plot into a pure image sequence when all cuts are uploaded", async () => {
    const storyDir = seedCuts("toon", ["https://ipfs.example/Qm1", "https://ipfs.example/Qm2"]);
    // A scaffold plot-01.md full of instructional prose (the #211 starting state).
    fs.writeFileSync(
      path.join(storyDir, "plot-01.md"),
      [
        "# Swipe Right, Refund Later",
        "",
        "Upload the lettered final images, then click Generate MD to assemble the episode.",
        "",
        "TODO: remember to double-check the order before publishing.",
      ].join("\n"),
      "utf-8",
    );

    const res = await app.request("/api/stories/toon/cuts/plot-01/generate-markdown", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.warnings).toEqual([]);

    const md = fs.readFileSync(path.join(storyDir, "plot-01.md"), "utf-8");
    // Pure image sequence: both uploaded URLs present, no scaffold prose survives.
    expect(md).toContain("![Scene 1](https://ipfs.example/Qm1)");
    expect(md).toContain("![Scene 2](https://ipfs.example/Qm2)");
    expect(md).not.toContain("Upload the lettered final images");
    expect(md).not.toContain("# Swipe Right, Refund Later");
    expect(md).not.toMatch(/TODO/);

    const { checkMarkdownReadiness } = await import("../lib/cartoon-readiness");
    const cuts = readCutsFile(storyDir, "plot-01")!.cuts;
    expect(checkMarkdownReadiness(md, cuts).ready).toBe(true);
  });

  it("keeps a clear not-ready state (no misleading publish markdown) when uploads are missing", async () => {
    const storyDir = seedCuts("toon2", ["https://ipfs.example/Qm1", null]);
    fs.writeFileSync(path.join(storyDir, "plot-01.md"), "Placeholder scaffold.\n", "utf-8");

    const res = await app.request("/api/stories/toon2/cuts/plot-01/generate-markdown", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings).toContain("Cut 2: missing upload URL");

    const md = fs.readFileSync(path.join(storyDir, "plot-01.md"), "utf-8");
    expect(md).toContain("![Scene 1](https://ipfs.example/Qm1)");
    // Missing cut is an awaiting-upload marker, never a fake/local image ref.
    expect(md).toContain("<!-- Cut 2: awaiting upload -->");
    expect(md).not.toContain("![Scene 2]");
    expect(md).not.toContain("Placeholder scaffold.");

    // Publish stays blocked while a cut is unuploaded.
    const { checkMarkdownReadiness } = await import("../lib/cartoon-readiness");
    const cuts = readCutsFile(storyDir, "plot-01")!.cuts;
    expect(checkMarkdownReadiness(md, cuts).ready).toBe(false);
  });
});

describe("GET /api/stories/:name/progress — story progress overview (#418)", () => {
  let tmpDir: string;
  let app: Hono;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-progress-"));
    testState.storiesDir = tmpDir;
    app = new Hono();
    app.route("/api/stories", storiesRoutes);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("aggregates metadata, setup, cover and per-episode state for a cartoon story", async () => {
    const storyDir = path.join(tmpDir, "god-cell");
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, ".story.json"), JSON.stringify({ contentType: "cartoon", language: "Korean", genre: "Science Fiction" }));
    fs.writeFileSync(path.join(storyDir, "structure.md"), "# 신의 세포\n");
    fs.writeFileSync(path.join(storyDir, "genesis.md"), "# 신의 세포\n\nA cell awakens.");
    // Genesis-as-Episode-1 has a real cut plan; plot-01 is an empty placeholder.
    writeCutsFile(storyDir, "genesis", createCutsFile("genesis", 2));
    fs.writeFileSync(path.join(storyDir, "plot-01.md"), "# Episode 2\n\nPlaceholder, not started.");
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 0));

    const res = await app.request("/api/stories/god-cell/progress");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contentType).toBe("cartoon");
    expect(body.metadata.language).toBe("Korean");
    expect(body.metadata.genre).toBe("Science Fiction");
    expect(body.setup.hasStructure).toBe(true);
    expect(body.setup.hasGenesis).toBe(true);
    expect(body.cover).toBe("missing");

    const genesis = body.episodes.find((e: { file: string }) => e.file === "genesis.md");
    expect(genesis.label).toBe("Episode 1 / Genesis");
    const plot = body.episodes.find((e: { file: string }) => e.file === "plot-01.md");
    expect(plot.label).toBe("Episode 2");
    expect(plot.state).toBe("placeholder"); // empty cuts ⇒ not started, never ready
    expect(body.summary.placeholders).toBe(1);
    // #462: a mid-production episode (Genesis is planning, not publish-ready)
    // leads over a missing cover — production is the primary next step; the
    // missing cover stays visible as the `cover` state (asserted above), a
    // publish-readiness recommendation, not the main action.
    expect(body.nextAction).toMatch(/Episode 1 \/ Genesis/i);
    expect(body.nextAction).not.toMatch(/cover/i);
  });

  it("404s for a missing story", async () => {
    const res = await app.request("/api/stories/nope/progress");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/stories/:name/progress — workflow coach (#429)", () => {
  // Minimal valid WebP header so the undetected-clean scan accepts an on-disk file.
  const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00, 0x00]);
  let tmpDir: string;
  let app: Hono;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-coach-"));
    testState.storiesDir = tmpDir;
    app = new Hono();
    app.route("/api/stories", storiesRoutes);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  function seedCartoon(name: string): string {
    const storyDir = path.join(tmpDir, name);
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, ".story.json"), JSON.stringify({ contentType: "cartoon" }));
    fs.writeFileSync(path.join(storyDir, "structure.md"), "# Bible\n");
    fs.writeFileSync(path.join(storyDir, "genesis.md"), "# Opening\n\nIt begins.");
    return storyDir;
  }

  it("attaches a cartoon coach: planned-but-no-clean genesis ⇒ Generate clean images (agent)", async () => {
    const storyDir = seedCartoon("god-cell");
    writeCutsFile(storyDir, "genesis", createCutsFile("genesis", 2)); // cuts planned, no clean images

    const body = await (await app.request("/api/stories/god-cell/progress")).json();
    expect(body.coach).toBeTruthy();
    expect(body.coach.actionKind).toBe("agent");
    expect(body.coach.action).toBe("Generate clean images");
    expect(body.coach.episodeFile).toBe("genesis.md");
  });

  it("?focus on a future-episode placeholder ⇒ 'Plan this episode first' (acceptance #3)", async () => {
    const storyDir = seedCartoon("god-cell");
    writeCutsFile(storyDir, "genesis", createCutsFile("genesis", 1));
    fs.writeFileSync(path.join(storyDir, "plot-01.md"), "# Episode 2\n\nPlaceholder.");
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 0)); // empty ⇒ placeholder

    const body = await (await app.request("/api/stories/god-cell/progress?focus=plot-01.md")).json();
    expect(body.coach.action).toBe("Plan this episode first");
    expect(body.coach.episodeFile).toBe("plot-01.md");
  });

  it("clean images on disk but unrecorded ⇒ coach offers Refresh assets, not Generate (acceptance #2)", async () => {
    const storyDir = seedCartoon("god-cell");
    writeCutsFile(storyDir, "genesis", createCutsFile("genesis", 1));
    fs.writeFileSync(path.join(storyDir, "plot-01.md"), "# Episode 2\n");
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 2)); // 2 cuts, cleanImagePath null
    // The agent generated the clean images on disk but they're not in cuts.json yet.
    fs.mkdirSync(path.join(storyDir, "assets/plot-01"), { recursive: true });
    fs.writeFileSync(path.join(storyDir, "assets/plot-01/cut-01-clean.webp"), WEBP);
    fs.writeFileSync(path.join(storyDir, "assets/plot-01/cut-02-clean.webp"), WEBP);

    const body = await (await app.request("/api/stories/god-cell/progress?focus=plot-01.md")).json();
    expect(body.coach.actionKind).toBe("ui");
    expect(body.coach.uiAction).toBe("refresh-assets");
  });

  it("fiction stories get no coach (coach: null) — fiction UX unchanged (acceptance #5)", async () => {
    const storyDir = path.join(tmpDir, "novel");
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, ".story.json"), JSON.stringify({ contentType: "fiction" }));
    fs.writeFileSync(path.join(storyDir, "structure.md"), "# Outline\n");
    fs.writeFileSync(path.join(storyDir, "genesis.md"), "# Hook\n");

    const body = await (await app.request("/api/stories/novel/progress")).json();
    expect(body.coach).toBeNull();
    // The #423 next-action line is still present for fiction.
    expect(body.nextAction).toBeTruthy();
  });
});

describe("POST /api/stories/create — guided New Story setup (#423)", () => {
  let tmpDir: string;
  let app: Hono;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-create-"));
    testState.storiesDir = tmpDir;
    app = new Hono();
    app.route("/api/stories", storiesRoutes);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  function create(body: Record<string, unknown>) {
    return app.request("/api/stories/create", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  }

  it("creates a named cartoon story (.story.json + CLAUDE.md) from the chosen title up front", async () => {
    const res = await create({ title: "Ghost Signal", language: "English", genre: "Science Fiction", contentType: "cartoon" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("ghost-signal");
    const meta = readStoryMeta(path.join(tmpDir, "ghost-signal"));
    expect(meta.contentType).toBe("cartoon");
    expect(meta.title).toBe("Ghost Signal");
    expect(meta.genre).toBe("Science Fiction");
    expect(meta.language).toBe("English");
    expect(meta.agentProvider).toBe("codex"); // cartoon forces Codex
    // (CLAUDE.md generation via writeStoryInstructions is covered by the
    // generate-story-instructions suite; it's module-mocked in this file.)
  });

  it("keeps a non-Latin title in .story.json with an ASCII fallback slug (신의 세포)", async () => {
    const res = await create({ title: "신의 세포", language: "Korean", contentType: "cartoon" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("story"); // ASCII fallback slug
    // The real Korean title is preserved and is what the UI displays.
    expect(readStoryMeta(path.join(tmpDir, "story")).title).toBe("신의 세포");
  });

  it("disambiguates duplicate slugs (same title twice → -2)", async () => {
    await create({ title: "Dusk", contentType: "fiction" });
    const res = await create({ title: "Dusk", contentType: "fiction" });
    expect((await res.json()).name).toBe("dusk-2");
    expect(fs.existsSync(path.join(tmpDir, "dusk"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "dusk-2"))).toBe(true);
  });

  it("400s on an empty title", async () => {
    const res = await create({ title: "   ", contentType: "fiction" });
    expect(res.status).toBe(400);
  });

  it("fiction keeps its chosen provider (not forced to Codex)", async () => {
    await create({ title: "Quiet Novel", contentType: "fiction", agentProvider: "claude" });
    expect(readStoryMeta(path.join(tmpDir, "quiet-novel")).agentProvider).toBe("claude");
  });
});
