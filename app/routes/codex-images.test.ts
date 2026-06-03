// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const testState = vi.hoisted(() => ({ cacheDir: "" }));

vi.mock("../lib/paths", () => ({
  get CODEX_IMAGES_DIR() {
    return testState.cacheDir;
  },
}));

import { codexImagesRoutes } from "./codex-images";
import { encodeCodexToken } from "../lib/codex-images";
import { Hono } from "hono";

// Minimal valid magic-byte prefixes so sniffImageType recognizes the content.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00, 0x00,
]);

// #403: the read-only Codex cache routes that back the one-click import picker.
describe("codex cache routes (#403)", () => {
  let tmp: string;
  let app: Hono;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-route-"));
    testState.cacheDir = tmp;
    app = new Hono();
    app.route("/api/codex", codexImagesRoutes);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function write(rel: string, bytes: Buffer) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes);
  }

  it("lists recent cache images", async () => {
    write("ig_one.png", PNG);
    write("sub/ig_two.webp", WEBP);
    const res = await app.request("/api/codex/images");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.images.map((i: { name: string }) => i.name).sort()).toEqual([
      "ig_one.png",
      "ig_two.webp",
    ]);
  });

  it("lists empty when the cache directory does not exist", async () => {
    testState.cacheDir = path.join(tmp, "missing");
    const res = await app.request("/api/codex/images");
    expect(res.status).toBe(200);
    expect((await res.json()).images).toEqual([]);
  });

  it("serves a cache image with its sniffed content type", async () => {
    write("ig_one.png", PNG);
    const token = encodeCodexToken("ig_one.png");
    const res = await app.request(`/api/codex/images/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(PNG));
  });

  it("rejects a traversal token with 400", async () => {
    const token = encodeCodexToken("../../etc/passwd");
    const res = await app.request(`/api/codex/images/${token}`);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a token pointing at a missing file", async () => {
    const token = encodeCodexToken("ig_gone.png");
    const res = await app.request(`/api/codex/images/${token}`);
    expect(res.status).toBe(404);
  });

  it("refuses to serve a non-image file with 415", async () => {
    write("notes.png", Buffer.from("this is plain text, not an image"));
    const token = encodeCodexToken("notes.png");
    const res = await app.request(`/api/codex/images/${token}`);
    expect(res.status).toBe(415);
  });
});
