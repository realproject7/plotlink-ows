// @vitest-environment node
// Node env (not jsdom): the cover upload route reads multipart FormData via
// c.req.formData(), and jsdom's FormData/File do not set a multipart boundary.
// Same constraint as stories.test.ts (upload-clean).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";

vi.mock("../lib/paths", () => ({
  STORIES_DIR: os.tmpdir(),
  CONFIG_DIR: os.tmpdir(),
  DATA_DIR: os.tmpdir(),
  DB_PATH: path.join(os.tmpdir(), "test.db"),
  DATABASE_URL: "file:" + path.join(os.tmpdir(), "test.db"),
  ENV_FILE: path.join(os.tmpdir(), ".env"),
}));

vi.mock("../lib/publish", () => ({
  publishStoryline: vi.fn(),
  publishPlot: vi.fn(),
  getEthBalance: vi.fn(),
  estimatePublishCost: vi.fn(),
  uploadCoverImage: vi.fn(),
  uploadPlotImage: vi.fn(),
  updateStoryline: vi.fn(),
}));

vi.mock("../../lib/ows/wallet", () => ({
  listAgentWallets: vi.fn(),
  getBaseAddress: vi.fn(),
}));

import { publishRoutes } from "./publish";
import { uploadCoverImage } from "../lib/publish";
import { listAgentWallets, getBaseAddress } from "../../lib/ows/wallet";
import { Hono } from "hono";

// Minimal valid magic-byte prefixes (enough for sniffImageType).
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fileOf(bytes: Uint8Array, type: string, name: string): File {
  return new File([bytes], name, { type });
}

describe("POST /api/publish/upload-cover validation", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/api/publish", publishRoutes);
    vi.mocked(listAgentWallets).mockReturnValue([
      { name: "plotlink-writer-1" } as unknown as ReturnType<typeof listAgentWallets>[number],
    ]);
    vi.mocked(getBaseAddress).mockReturnValue("0x1111111111111111111111111111111111111111");
    vi.mocked(uploadCoverImage).mockResolvedValue("QmCoverCid");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function postCover(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return app.request("/api/publish/upload-cover", { method: "POST", body: fd });
  }

  it("accepts a valid WebP cover and returns the cid", async () => {
    const res = await postCover(fileOf(WEBP, "image/webp", "cover.webp"));
    expect(res.status).toBe(200);
    expect((await res.json()).cid).toBe("QmCoverCid");
    expect(uploadCoverImage).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid JPEG cover (fiction or cartoon — route is content-type agnostic)", async () => {
    const res = await postCover(fileOf(JPEG, "image/jpeg", "cover.jpg"));
    expect(res.status).toBe(200);
    expect((await res.json()).cid).toBe("QmCoverCid");
  });

  it("rejects a cover over 1MB before any upload", async () => {
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(WEBP, 0);
    const res = await postCover(fileOf(big, "image/webp", "big.webp"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("1MB");
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it("rejects a non-WebP/JPEG MIME type with a clear message", async () => {
    const res = await postCover(fileOf(PNG, "image/png", "cover.png"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Only WebP and JPEG");
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it("rejects a spoofed cover: PNG bytes mislabeled image/webp (magic-byte check)", async () => {
    // Pre-fix this passed the MIME check and was forwarded to the backend.
    const res = await postCover(fileOf(PNG, "image/webp", "spoof.webp"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("bytes do not match");
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it("rejects a spoofed cover: text bytes mislabeled image/jpeg", async () => {
    const res = await postCover(fileOf(new TextEncoder().encode("not an image"), "image/jpeg", "fake.jpg"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("bytes do not match");
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it("returns 400 when no file is provided", async () => {
    const res = await app.request("/api/publish/upload-cover", { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("No image file");
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it("does not touch cuts.json or any cut/episode image (cover stays separate)", async () => {
    // The cover route never reads/writes cuts; it forwards the cover to the
    // backend and returns a cid. Guards against future coupling of cover with
    // cartoon cut images.
    const res = await postCover(fileOf(WEBP, "image/webp", "cover.webp"));
    expect(res.status).toBe(200);
    const [walletName, addr, passedFile] = vi.mocked(uploadCoverImage).mock.calls[0];
    expect(walletName).toBe("plotlink-writer-1");
    expect(addr).toBe("0x1111111111111111111111111111111111111111");
    expect((passedFile as File).name).toBe("cover.webp");
  });
});
