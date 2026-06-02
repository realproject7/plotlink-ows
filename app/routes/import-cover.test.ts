// @vitest-environment node
// Node env (not jsdom): pure fs/Hono route test; multipart FormData upload
// bodies only serialize correctly under node (jsdom's FormData/File do not set a
// multipart boundary for c.req.formData()).
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
import { Hono } from "hono";

// #301: import-cover persists a browser-converted cover as the deterministic
// local asset assets/cover.webp (or .jpg) so a Codex-generated image can become
// a compliant cover without agent-side shell image tools. The browser does the
// PNG→WebP conversion (see import-image.test.ts); this route validates + saves.
describe("POST /import-cover route (#301)", () => {
  let tmpDir: string;
  let app: Hono;

  const WEBP_BYTES = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00, 0x00,
  ]);
  const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-importcover-"));
    testState.storiesDir = tmpDir;
    app = new Hono();
    app.route("/api/stories", storiesRoutes);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedStory(name: string) {
    const storyDir = path.join(tmpDir, name);
    fs.mkdirSync(storyDir, { recursive: true });
    return storyDir;
  }

  function importCover(story: string, bytes: Uint8Array, mime: string, filename: string) {
    const fd = new FormData();
    fd.append("file", new File([bytes], filename, { type: mime }));
    return app.request(`/api/stories/${story}/import-cover`, { method: "POST", body: fd });
  }

  it("saves a converted WebP as assets/cover.webp under 1MB", async () => {
    const storyDir = seedStory("imp-webp");
    const res = await importCover("imp-webp", WEBP_BYTES, "image/webp", "cover.webp");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe("assets/cover.webp");
    const saved = path.join(storyDir, "assets/cover.webp");
    expect(fs.existsSync(saved)).toBe(true);
    expect(fs.statSync(saved).size).toBeLessThanOrEqual(1024 * 1024);
  });

  it("saves a JPEG fallback as assets/cover.jpg", async () => {
    const storyDir = seedStory("imp-jpeg");
    const res = await importCover("imp-jpeg", JPEG_BYTES, "image/jpeg", "cover.jpg");
    expect(res.status).toBe(200);
    expect((await res.json()).path).toBe("assets/cover.jpg");
    expect(fs.existsSync(path.join(storyDir, "assets/cover.jpg"))).toBe(true);
  });

  it("removes a stale sibling cover so detection stays unambiguous", async () => {
    const storyDir = seedStory("imp-replace");
    fs.mkdirSync(path.join(storyDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(storyDir, "assets/cover.webp"), Buffer.from(WEBP_BYTES));
    // Import a JPEG → should write cover.jpg AND drop the old cover.webp.
    const res = await importCover("imp-replace", JPEG_BYTES, "image/jpeg", "cover.jpg");
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(storyDir, "assets/cover.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(storyDir, "assets/cover.webp"))).toBe(false);
  });

  it("rejects PNG bytes labeled image/webp: 400, nothing written", async () => {
    const storyDir = seedStory("imp-png");
    const res = await importCover("imp-png", PNG_BYTES, "image/webp", "cover.webp");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not a valid WebP/JPEG image");
    expect(fs.existsSync(path.join(storyDir, "assets/cover.webp"))).toBe(false);
  });

  it("rejects a disallowed MIME (image/png) before byte validation: 400", async () => {
    const storyDir = seedStory("imp-pngmime");
    const res = await importCover("imp-pngmime", PNG_BYTES, "image/png", "cover.png");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Only WebP and JPEG");
    expect(fs.existsSync(path.join(storyDir, "assets/cover.png"))).toBe(false);
  });

  it("rejects an oversize cover (>1MB): 400, nothing written", async () => {
    const storyDir = seedStory("imp-big");
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(WEBP_BYTES, 0); // valid header, but over the size limit
    const res = await importCover("imp-big", big, "image/webp", "cover.webp");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("under 1MB");
    expect(fs.existsSync(path.join(storyDir, "assets/cover.webp"))).toBe(false);
  });

  it("returns 404 for a missing story", async () => {
    const res = await importCover("nope", WEBP_BYTES, "image/webp", "cover.webp");
    expect(res.status).toBe(404);
  });
});
